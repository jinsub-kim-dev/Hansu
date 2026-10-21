"""사용자와 플랫폼 계정 연결."""

from sqlmodel import Session, select

from app.auth.providers import Identity, OAuthError
from app.importers.base import upsert_player
from app.models.db import LinkedAccount, User


class AccountConflict(OAuthError):
    pass


def link_account(session: Session, user_id: int | None, platform: str, ident: Identity) -> int:
    """OAuth로 확인한 계정을 사용자에 연결하고, 로그인할 사용자 id를 돌려준다.

    - 이미 연결된 계정이면 그 계정의 사용자로 로그인한다(로그인 중인 사용자와 다르면 오류).
    - 처음 보는 계정이면 로그인 중인 사용자에 붙이고, 로그인 전이면 새 사용자를 만든다.
    - 한 사용자는 플랫폼마다 계정 하나만 연결한다(다른 계정으로 다시 연결하면 바꾼다).
    """
    existing = session.exec(
        select(LinkedAccount).where(
            LinkedAccount.platform == platform, LinkedAccount.username == ident.username
        )
    ).first()
    if existing:
        if user_id is not None and existing.user_id != user_id and session.get(User, user_id):
            raise AccountConflict("이 계정은 이미 다른 사용자에 연결돼 있습니다. 로그아웃한 뒤 다시 시도하세요.")
        existing.display_name = ident.display_name
        session.add(existing)
        upsert_player(session, platform, ident.username, display_name=ident.display_name)
        session.commit()
        return existing.user_id

    user = session.get(User, user_id) if user_id is not None else None
    if user is None:
        user = User()
        session.add(user)
        session.flush()
    for old in session.exec(
        select(LinkedAccount).where(LinkedAccount.user_id == user.id, LinkedAccount.platform == platform)
    ).all():
        session.delete(old)
    session.add(
        LinkedAccount(
            user_id=user.id, platform=platform, username=ident.username, display_name=ident.display_name
        )
    )
    upsert_player(session, platform, ident.username, display_name=ident.display_name)
    session.commit()
    return user.id


def user_accounts(session: Session, user_id: int) -> list[LinkedAccount]:
    return list(
        session.exec(
            select(LinkedAccount).where(LinkedAccount.user_id == user_id).order_by(LinkedAccount.platform)
        ).all()
    )
