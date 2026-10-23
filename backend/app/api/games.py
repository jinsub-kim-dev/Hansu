"""대국 목록과 대국 하나. 로그인한 사용자가 연결한 계정의 대국만 볼 수 있다."""

import re
from datetime import UTC, datetime
from typing import Annotated, Literal

import chess
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, and_, col, func, or_, select

from app.analysis.openings import get_book
from app.auth.access import current_user_id, linked_accounts, require_linked
from app.db import get_session
from app.i18n import AppError
from app.models.db import Game, PositionMove
from app.models.schemas import GameDetailOut, GameListOut, GameSummaryOut, OpeningOut, Platform, Side

router = APIRouter(tags=["games"])

Outcome = Literal["win", "draw", "loss"]
MAX_LIMIT = 50
# PGN 헤더의 이름은 플랫폼에 표시되는 대소문자 그대로다(DB에는 소문자로 둔다).
HEADER_RE = re.compile(r'^\[(White|Black) "([^"]*)"\]', re.MULTILINE)
FEN_RE = re.compile(r'^\[FEN "([^"]*)"\]', re.MULTILINE)  # 임의 포지션에서 시작한 대국


def _utc(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=UTC) if dt is not None and dt.tzinfo is None else dt


def _outcome(result: str, color: str) -> Outcome:
    if result == "1/2-1/2":
        return "draw"
    return "win" if (result == "1-0") == (color == "white") else "loss"


def _ucis(session: Session, game_id: int) -> list[str]:
    """색인해 둔 수순(PGN을 다시 풀지 않는다)."""
    return list(
        session.exec(select(PositionMove.uci).where(PositionMove.game_id == game_id).order_by(PositionMove.ply)).all()
    )


def _opening(ucis: list[str]) -> OpeningOut | None:
    board = chess.Board()  # 임의 포지션에서 시작한 대국은 첫 수부터 맞지 않아 이름 없이 끝난다
    moves = []
    for u in ucis[:40]:  # 오프닝 이름은 앞부분만 보면 된다
        move = chess.Move.from_uci(u)
        if move not in board.legal_moves:
            break
        moves.append(move)
        board.push(move)
    opening = get_book().classify(chess.Board(), moves).opening
    return OpeningOut(eco=opening.eco, name=opening.name) if opening else None


def _summary(game: Game, me: str, ucis: list[str]) -> GameSummaryOut:
    color: Side = "white" if game.white == me else "black"
    names = dict(HEADER_RE.findall(game.pgn[:2000]))
    opp_color = "black" if color == "white" else "white"
    return GameSummaryOut(
        id=game.id,
        platform=game.platform,
        url=game.url,
        color=color,
        outcome=_outcome(game.result, color),
        result=game.result,
        me=names.get(color.capitalize()) or me,
        my_rating=game.white_rating if color == "white" else game.black_rating,
        opponent=names.get(opp_color.capitalize()) or (game.black if color == "white" else game.white),
        opponent_rating=game.black_rating if color == "white" else game.white_rating,
        time_class=game.time_class,
        time_control=game.time_control,
        rated=game.rated,
        end_time=_utc(game.end_time),
        plies=len(ucis),
        opening=_opening(ucis),
    )


@router.get("/players/{platform}/{username}/games", response_model=GameListOut)
def list_games(
    platform: Platform,
    username: str,
    time_class: Annotated[list[str] | None, Query(description="시간 규칙. 여러 번 주면 OR")] = None,
    color: Annotated[Side | None, Query(description="내가 이 색을 잡은 대국만")] = None,
    outcome: Annotated[Outcome | None, Query(description="내 기준 결과")] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 30,
    session: Session = Depends(get_session),
    user_id: int | None = Depends(current_user_id),
):
    """연결한 계정의 대국 목록 (최근에 끝난 순). PGN은 빼고 보낸다."""
    me = username.lower()
    require_linked(session, user_id, platform, me)
    conds = [Game.platform == platform, or_(Game.white == me, Game.black == me)]
    if time_class:
        conds.append(col(Game.time_class).in_(time_class))
    if color:
        conds.append((Game.white if color == "white" else Game.black) == me)
    if outcome == "draw":
        conds.append(Game.result == "1/2-1/2")
    elif outcome:
        win_as = ("1-0", "0-1") if outcome == "win" else ("0-1", "1-0")
        conds.append(or_(and_(Game.white == me, Game.result == win_as[0]), and_(Game.black == me, Game.result == win_as[1])))
    total = session.exec(select(func.count()).select_from(Game).where(*conds)).one()
    games = session.exec(
        select(Game).where(*conds).order_by(col(Game.end_time).desc(), col(Game.id).desc()).offset(offset).limit(limit)
    ).all()
    return GameListOut(total=total, games=[_summary(g, me, _ucis(session, g.id)) for g in games])


@router.get("/games/{game_id}", response_model=GameDetailOut)
def get_game(game_id: int, session: Session = Depends(get_session), user_id: int | None = Depends(current_user_id)):
    """대국 하나와 수순. 백이나 흑이 내가 연결한 계정일 때만 연다(아니면 있는지도 알리지 않는다)."""
    if user_id is None:
        raise AppError("login_required", status_code=401)
    game = session.get(Game, game_id)
    mine = linked_accounts(session, user_id)
    if game is None or not ({(game.platform, game.white), (game.platform, game.black)} & mine):
        raise AppError("game_not_found", status_code=404)
    me = game.white if (game.platform, game.white) in mine else game.black
    ucis = _ucis(session, game.id)
    start = FEN_RE.search(game.pgn[:3000])
    return GameDetailOut(
        **_summary(game, me, ucis).model_dump(),
        start_fen=start.group(1) if start else chess.STARTING_FEN,
        moves=ucis,
        pgn=game.pgn,
    )
