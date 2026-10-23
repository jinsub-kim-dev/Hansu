"""사용자와 플랫폼 계정 연결."""

from datetime import UTC, datetime

from sqlmodel import Session, col, select

from app.auth.providers import Identity, OAuthError
from app.importers.base import upsert_player
from app.models.db import LinkedAccount, User


class AccountConflict(OAuthError):
    pass


def link_account(session: Session, user_id: int | None, platform: str, ident: Identity) -> int:
    """OAuth로 확인한 계정을 사용자에 연결하고, 로그인할 사용자 id를 돌려준다.

    - 이미 연결된 적 있는 계정이면 그 계정의 사용자로 로그인한다(로그인 중인 사용자와 다르면 오류).
      연결을 끊었던 계정이면 다시 살려, 예전 복기 노트를 그대로 볼 수 있게 한다.
    - 처음 보는 계정이면 로그인 중인 사용자에 붙이고, 로그인 전이면 새 사용자를 만든다.
    - 한 사용자는 플랫폼마다 계정 하나만 쓴다(다른 계정으로 연결하면 이전 계정은 해제된다).
    """
    now = datetime.now(UTC)
    existing = session.exec(
        select(LinkedAccount).where(
            LinkedAccount.platform == platform, LinkedAccount.username == ident.username
        )
    ).first()
    if existing:
        if user_id is not None and existing.user_id != user_id and session.get(User, user_id):
            raise AccountConflict("account_conflict")
        owner = existing.user_id
    else:
        user = session.get(User, user_id) if user_id is not None else None
        if user is None:
            user = User()
            session.add(user)
            session.flush()
        owner = user.id

    # 같은 플랫폼의 다른 계정은 해제한다.
    for other in session.exec(
        select(LinkedAccount).where(
            LinkedAccount.user_id == owner,
            LinkedAccount.platform == platform,
            LinkedAccount.username != ident.username,
            col(LinkedAccount.unlinked_at).is_(None),
        )
    ).all():
        other.unlinked_at = now
        session.add(other)

    account = existing or LinkedAccount(user_id=owner, platform=platform, username=ident.username)
    account.display_name = ident.display_name
    account.unlinked_at = None
    session.add(account)
    upsert_player(session, platform, ident.username, display_name=ident.display_name)
    session.commit()
    return owner


def user_accounts(session: Session, user_id: int) -> list[LinkedAccount]:
    """지금 연결돼 있는 계정(해제한 계정은 뺀다)."""
    return list(
        session.exec(
            select(LinkedAccount)
            .where(LinkedAccount.user_id == user_id, col(LinkedAccount.unlinked_at).is_(None))
            .order_by(LinkedAccount.platform)
        ).all()
    )
