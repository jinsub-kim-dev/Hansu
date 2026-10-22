"""플레이어 데이터 접근 제한: 로그인한 사용자는 자신이 연결한 플랫폼 계정의 대국만 다룰 수 있다."""

from fastapi import Request
from sqlmodel import Session, select

from app.i18n import AppError
from app.models.db import LinkedAccount


def current_user_id(request: Request) -> int | None:
    """세션 쿠키의 로그인 사용자 id (없으면 None). 테스트에서는 이 의존성을 바꿔 끼운다."""
    return request.session.get("user_id")


def linked_accounts(session: Session, user_id: int | None) -> set[tuple[str, str]]:
    """사용자가 연결한 (플랫폼, 소문자 아이디) 목록."""
    if user_id is None:
        return set()
    rows = session.exec(
        select(LinkedAccount.platform, LinkedAccount.username).where(LinkedAccount.user_id == user_id)
    ).all()
    return {(platform, username) for platform, username in rows}


def require_linked(session: Session, user_id: int | None, platform: str, username: str) -> None:
    """로그인하지 않았으면 401, 연결하지 않은 계정이면 403."""
    if user_id is None:
        raise AppError("login_required", status_code=401)
    if (platform, username.lower()) not in linked_accounts(session, user_id):
        raise AppError("account_not_linked", status_code=403, platform=platform)
