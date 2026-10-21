"""계정 연결(OAuth 로그인)과 현재 사용자.

로그인 상태는 서명된 세션 쿠키(SessionMiddleware)에 user_id로 둔다.
OAuth 콜백은 PUBLIC_BASE_URL(프론트엔드 주소) 아래 /api/auth/{platform}/callback 이다.
개발 중에는 Vite가 /api를 백엔드로 넘기므로 쿠키가 프론트엔드 주소에 붙는다.
"""

import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlmodel import Session, select

from app.api.players import get_job_manager
from app.auth.accounts import AccountConflict, link_account, user_accounts
from app.auth.providers import OAuthError, OAuthProvider, new_pkce
from app.config import settings
from app.db import get_session
from app.importers.jobs import ImportJobManager
from app.models.db import LinkedAccount, User
from app.models.schemas import AuthProviderOut, MeOut, Platform

router = APIRouter(tags=["auth"])


def get_providers(request: Request) -> dict[str, OAuthProvider]:
    return request.app.state.auth_providers


def _redirect_uri(platform: str) -> str:
    return f"{settings.public_base_url}/api/auth/{platform}/callback"


def _back_to_app(**query: str) -> RedirectResponse:
    return RedirectResponse(f"{settings.public_base_url}/?{urlencode(query)}", status.HTTP_302_FOUND)


@router.get("/auth/providers", response_model=list[AuthProviderOut])
def list_providers(providers: dict[str, OAuthProvider] = Depends(get_providers)):
    return [AuthProviderOut(platform=p.platform, label=p.label, enabled=p.enabled) for p in providers.values()]


@router.get("/auth/{platform}/login")
def login(platform: Platform, request: Request, providers: dict[str, OAuthProvider] = Depends(get_providers)):
    """플랫폼 로그인 화면으로 보낸다."""
    provider = providers[platform]
    if not provider.enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{provider.label} 계정 연결은 아직 준비 중입니다.")
    verifier, challenge = new_pkce()
    state = secrets.token_urlsafe(24)
    request.session["oauth"] = {"platform": platform, "state": state, "verifier": verifier}
    return RedirectResponse(provider.authorize_url(state, challenge, _redirect_uri(platform)), status.HTTP_302_FOUND)


@router.get("/auth/{platform}/callback")
def callback(
    platform: Platform,
    request: Request,
    background: BackgroundTasks,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    providers: dict[str, OAuthProvider] = Depends(get_providers),
    session: Session = Depends(get_session),
    jobs: ImportJobManager = Depends(get_job_manager),
):
    """플랫폼에서 돌아오면 본인 확인 → 계정 연결 → 대국 가져오기 시작 → 앱으로 돌려보낸다."""
    pending = request.session.pop("oauth", None)
    if error:
        return _back_to_app(auth_error="로그인을 취소했습니다." if error == "access_denied" else f"로그인 오류: {error}")
    if not pending or pending.get("platform") != platform or pending.get("state") != state or not code:
        return _back_to_app(auth_error="로그인 요청이 만료됐습니다. 다시 시도하세요.")
    try:
        ident = providers[platform].identify(code, pending["verifier"], _redirect_uri(platform))
        user_id = link_account(session, request.session.get("user_id"), platform, ident)
    except (OAuthError, AccountConflict) as exc:
        return _back_to_app(auth_error=str(exc))
    request.session["user_id"] = user_id

    # 연결하자마자 대국을 가져온다(처음이면 최근 N년, 이미 있으면 업데이트).
    job, created = jobs.create(platform, ident.username)
    if created:
        background.add_task(jobs.run, job.id)
    return _back_to_app(linked=platform, job=job.id)


@router.get("/me", response_model=MeOut)
def me(request: Request, session: Session = Depends(get_session)):
    user_id = request.session.get("user_id")
    if user_id is None or session.get(User, user_id) is None:
        request.session.pop("user_id", None)
        return MeOut(user_id=None, accounts=[])
    return MeOut(user_id=user_id, accounts=[a.model_dump() for a in user_accounts(session, user_id)])


@router.post("/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.delete("/me/accounts/{platform}")
def unlink(platform: Platform, request: Request, session: Session = Depends(get_session)):
    """계정 연결만 끊는다. 이미 가져온 대국 데이터는 남는다."""
    user_id = request.session.get("user_id")
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인이 필요합니다.")
    for acc in session.exec(
        select(LinkedAccount).where(LinkedAccount.user_id == user_id, LinkedAccount.platform == platform)
    ).all():
        session.delete(acc)
    session.commit()
    return {"ok": True}
