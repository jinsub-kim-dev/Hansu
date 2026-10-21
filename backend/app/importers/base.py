"""수집기 공통 부분: 플랫폼 응답을 공통 Game으로 바꾼 뒤 저장하고 포지션 색인을 만든다."""

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlmodel import Session, func, or_, select

from app.analysis.positions import extract_moves
from app.i18n import AppError
from app.models.db import Game, Player, PositionMove

log = logging.getLogger(__name__)


class ImporterError(AppError):
    """사용자에게 보여줄 수 있는 수집 오류."""


class PlayerNotFound(ImporterError):
    status_code = 404


@dataclass
class NormalizedGame:
    platform: str
    external_id: str
    url: str | None
    white: str
    black: str
    white_rating: int | None
    black_rating: int | None
    time_class: str | None
    time_control: str | None
    rated: bool | None
    result: str
    end_time: datetime | None
    pgn: str


@dataclass
class ImportProgress:
    archives_total: int = 0
    archives_done: int = 0
    archives_skipped: int = 0
    games_added: int = 0
    games_seen: int = 0  # 받아 본 대국 수 (아카이브 단위가 없는 플랫폼의 진행률)
    mode: str = "initial"  # initial: 최근 N년 처음 가져오기, update: 마지막 대국 이후만
    since: datetime | None = None  # 이 시각 이후에 끝난 대국만 가져온다


ProgressCallback = Callable[[ImportProgress], None]


def years_before(t: datetime, years: int) -> datetime:
    try:
        return t.replace(year=t.year - years)
    except ValueError:  # 2월 29일
        return t.replace(year=t.year - years, day=28)


def last_game_end(session: Session, platform: str, username: str) -> datetime | None:
    """DB에 저장된 이 플레이어의 가장 최근 대국이 끝난 시각 (UTC)."""
    last = session.exec(
        select(func.max(Game.end_time)).where(
            Game.platform == platform, or_(Game.white == username, Game.black == username)
        )
    ).one()
    if last is not None and last.tzinfo is None:  # SQLite는 시간대를 저장하지 않는다.
        last = last.replace(tzinfo=UTC)
    return last


def upsert_player(
    session: Session,
    platform: str,
    username: str,
    display_name: str | None = None,
    imported_at: datetime | None = None,
) -> Player:
    """플레이어를 목록에 기록한다. 주어진 값만 갱신한다. 커밋은 호출자가 한다."""
    player = session.exec(
        select(Player).where(Player.platform == platform, Player.username == username)
    ).first()
    if player is None:
        player = Player(platform=platform, username=username)
    if display_name:
        player.display_name = display_name
    if imported_at:
        player.last_imported_at = imported_at
    session.add(player)
    return player


def store_games(session: Session, games: Iterable[NormalizedGame]) -> int:
    """새 대국만 저장하고 포지션 색인을 만든다. 저장한 대국 수를 돌려준다. 커밋은 호출자가 한다."""
    games = list(games)
    if not games:
        return 0
    platform = games[0].platform
    ids = [g.external_id for g in games]
    existing = set(
        session.exec(
            select(Game.external_id).where(Game.platform == platform, Game.external_id.in_(ids))
        ).all()
    )
    added = 0
    for ng in games:
        if ng.external_id in existing:
            continue
        existing.add(ng.external_id)
        try:
            moves = extract_moves(ng.pgn)
        except Exception:  # 깨진 PGN 하나 때문에 전체 수집이 멈추지 않게 한다.
            log.warning("PGN 파싱 실패: %s %s", ng.platform, ng.external_id, exc_info=True)
            continue
        game = Game(**ng.__dict__)
        session.add(game)
        session.flush()
        session.add_all(
            PositionMove(
                game_id=game.id,
                ply=m.ply,
                position_key=m.position_key,
                color=m.color,
                uci=m.uci,
                san=m.san,
            )
            for m in moves
        )
        added += 1
    return added
