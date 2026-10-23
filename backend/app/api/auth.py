"""계정 연결(OAuth 로그인)과 현재 사용자.

로그인 상태는 서명된 세션 쿠키(SessionMiddleware)에 user_id로 둔다.
OAuth 콜백은 PUBLIC_BASE_URL(프론트엔드 주소) 아래 /api/auth/{platform}/callback 이다.
개발 중에는 Vite가 /api를 백엔드로 넘기므로 쿠키가 프론트엔드 주소에 붙는다.
"""

import secrets
from datetime import UTC, datetime
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Depends, Request, status
from fastapi.responses import RedirectResponse
from sqlmodel import Session

from app.api.players import get_job_manager
from app.auth.accounts import AccountConflict, link_account, user_accounts
from app.auth.providers import OAuthError, OAuthProvider, new_pkce
from app.config import settings
from app.i18n import AppError, Lang, get_lang, platform_name
from app.db import get_session
from app.importers.jobs import ImportJobManager
from app.models.db import User
from app.models.schemas import AuthProviderOut, MeOut, Platform

router = APIRouter(tags=["auth"])


def get_providers(request: Request) -> dict[str, OAuthProvider]:
    return request.app.state.auth_providers


def _redirect_uri(platform: str) -> str:
    return f"{settings.public_base_url}/api/auth/{platform}/callback"


def _back_to_app(**query: str) -> RedirectResponse:
    return RedirectResponse(f"{settings.public_base_url}/?{urlencode(query)}", status.HTTP_302_FOUND)


@router.get("/auth/providers", response_model=list[AuthProviderOut])
def list_providers(
    providers: dict[str, OAuthProvider] = Depends(get_providers), lang: Lang = Depends(get_lang)
):
    return [
        AuthProviderOut(platform=p.platform, label=platform_name(p.platform, lang), enabled=p.enabled)
        for p in providers.values()
    ]


@router.get("/auth/{platform}/login")
def login(platform: Platform, request: Request, providers: dict[str, OAuthProvider] = Depends(get_providers)):
    """플랫폼 로그인 화면으로 보낸다."""
    provider = providers[platform]
    if not provider.enabled:
        raise AppError("provider_not_ready", status_code=400, platform=platform)
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
        return _back_to_app(auth_error="login_cancelled" if error == "access_denied" else "login_error")
    if not pending or pending.get("platform") != platform or pending.get("state") != state or not code:
        return _back_to_app(auth_error="login_expired")
    try:
        ident = providers[platform].identify(code, pending["verifier"], _redirect_uri(platform))
        user_id = link_account(session, request.session.get("user_id"), platform, ident)
    except (OAuthError, AccountConflict) as exc:
        return _back_to_app(auth_error=exc.code)
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
    """계정 연결을 끊는다. 가져온 대국과 복기 노트는 남고, 같은 계정을 다시 연결하면 돌아온다.

    마지막 계정까지 끊으면 볼 수 있는 데이터가 없으므로 로그아웃한다.
    """
    user_id = request.session.get("user_id")
    if user_id is None:
        raise AppError("login_required", status_code=401)
    for acc in user_accounts(session, user_id):
        if acc.platform == platform:
            acc.unlinked_at = datetime.now(UTC)
            session.add(acc)
    session.commit()
    signed_out = not user_accounts(session, user_id)
    if signed_out:
        request.session.clear()
    return {"ok": True, "signed_out": signed_out}
