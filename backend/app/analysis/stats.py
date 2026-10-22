"""저장된 대국으로 계산하는 통계."""

from collections.abc import Sequence
from datetime import UTC, datetime
from dataclasses import dataclass, field

import chess
from sqlalchemy import case, distinct, func, or_
from sqlmodel import Session, select

from app.analysis.positions import board_from_key, position_hash
from app.models.db import Game, Player, PositionMove


@dataclass
class MoveStat:
    uci: str
    san: str
    games: int = 0
    wins: int = 0  # 대상 플레이어 기준
    draws: int = 0
    losses: int = 0


@dataclass
class MoveStatGroup:
    total: int = 0
    moves: list[MoveStat] = field(default_factory=list)


@dataclass
class PositionMoveStats:
    position_key: str
    player: MoveStatGroup  # 이 포지션에서 플레이어 본인이 둔 수
    opponent: MoveStatGroup  # 이 포지션에서 플레이어의 상대들이 둔 수


def _outcome(result: str, player_color: str) -> str:
    if result == "1/2-1/2":
        return "draw"
    white_won = result == "1-0"
    return "win" if white_won == (player_color == "white") else "loss"


def position_move_stats(
    session: Session,
    platform: str,
    username: str,
    position_key: str,
    time_classes: Sequence[str] | None = None,
    player_color: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> PositionMoveStats:
    """주어진 포지션에서 다음에 둔 수를 플레이어 본인/상대로 나눠 집계한다.

    time_classes가 비어 있지 않으면 그 시간 규칙의 대국만 센다.
    since/until을 주면 그 사이(since 이상, until 미만)에 끝난 대국만 센다.
    한 대국에서 같은 포지션이 반복돼도 수마다 대국 하나로 센다.
    """
    username = username.lower()
    board = board_from_key(position_key)
    pc = case((Game.white == username, "white"), else_="black").label("player_color")
    stmt = (
        select(
            PositionMove.uci,
            PositionMove.white_to_move,
            pc,
            Game.result,
            func.count(distinct(PositionMove.game_id)),
        )
        .join(Game, Game.id == PositionMove.game_id)
        .where(
            PositionMove.position_hash == position_hash(position_key),
            Game.platform == platform,
            or_(Game.white == username, Game.black == username),
        )
        .group_by(PositionMove.uci, PositionMove.white_to_move, pc, Game.result)
    )
    if time_classes:
        stmt = stmt.where(Game.time_class.in_(time_classes))
    if since is not None:
        stmt = stmt.where(Game.end_time >= _as_utc(since))
    if until is not None:
        stmt = stmt.where(Game.end_time < _as_utc(until))
    if player_color == "white":
        stmt = stmt.where(Game.white == username)
    elif player_color == "black":
        stmt = stmt.where(Game.black == username)

    buckets: dict[str, dict[str, MoveStat]] = {"player": {}, "opponent": {}}
    for uci, white_to_move, p_color, result, count in session.exec(stmt).all():
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:  # 해시 충돌 등으로 이 포지션의 수가 아니면 버린다
            continue
        mover = "white" if white_to_move else "black"
        side = "player" if mover == p_color else "opponent"
        stat = buckets[side].setdefault(uci, MoveStat(uci=uci, san=board.san(move)))
        stat.games += count
        match _outcome(result, p_color):
            case "win":
                stat.wins += count
            case "draw":
                stat.draws += count
            case "loss":
                stat.losses += count

    def group(side: str) -> MoveStatGroup:
        moves = sorted(buckets[side].values(), key=lambda s: (-s.games, s.san))
        return MoveStatGroup(total=sum(m.games for m in moves), moves=moves)

    return PositionMoveStats(
        position_key=position_key, player=group("player"), opponent=group("opponent")
    )


def _as_utc(dt: datetime) -> datetime:
    """비교용으로 UTC 시각으로 맞춘다. 시간대가 없으면 UTC로 본다."""
    return dt.astimezone(UTC) if dt.tzinfo else dt.replace(tzinfo=UTC)


def _utc(dt: datetime | None) -> datetime | None:
    """SQLite는 시간대를 저장하지 않으므로 읽은 시각을 UTC로 표시해 내보낸다."""
    return dt.replace(tzinfo=UTC) if dt is not None and dt.tzinfo is None else dt


def player_summary(session: Session, platform: str, username: str) -> dict:
    username = username.lower()
    player = session.exec(
        select(Player).where(Player.platform == platform, Player.username == username)
    ).first()
    rows = session.exec(
        select(Game.time_class, func.count(), func.min(Game.end_time), func.max(Game.end_time))
        .where(Game.platform == platform, or_(Game.white == username, Game.black == username))
        .group_by(Game.time_class)
    ).all()
    by_time_class = {tc or "unknown": n for tc, n, _, _ in rows}
    starts = [r[2] for r in rows if r[2]]
    ends = [r[3] for r in rows if r[3]]
    return {
        "platform": platform,
        "username": username,
        "display_name": player.display_name if player else None,
        "saved": player is not None,
        "last_imported_at": _utc(player.last_imported_at) if player else None,
        "total_games": sum(by_time_class.values()),
        "by_time_class": by_time_class,
        "first_game_at": _utc(min(starts)) if starts else None,
        "last_game_at": _utc(max(ends)) if ends else None,
    }


def list_players(session: Session, platform: str | None = None) -> list[dict]:
    """저장된 플레이어 목록. 최근에 가져온 순."""
    stmt = select(Player)
    if platform:
        stmt = stmt.where(Player.platform == platform)
    players = session.exec(stmt).all()
    counts: dict[tuple[str, str], int] = {}
    last_game: dict[tuple[str, str], datetime] = {}
    for side in (Game.white, Game.black):
        rows = session.exec(
            select(Game.platform, side, func.count(), func.max(Game.end_time)).group_by(Game.platform, side)
        ).all()
        for p, u, n, last in rows:
            counts[(p, u)] = counts.get((p, u), 0) + n
            prev = last_game.get((p, u))
            if last is not None and (prev is None or last > prev):
                last_game[(p, u)] = last
    out = [
        {
            "platform": pl.platform,
            "username": pl.username,
            "display_name": pl.display_name,
            "last_imported_at": _utc(pl.last_imported_at),
            "total_games": counts.get((pl.platform, pl.username), 0),
            "last_game_at": _utc(last_game.get((pl.platform, pl.username))),
        }
        for pl in players
    ]
    out.sort(key=lambda d: d["last_imported_at"] or datetime.min.replace(tzinfo=UTC), reverse=True)
    return out
