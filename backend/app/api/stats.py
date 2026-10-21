from dataclasses import asdict
from datetime import datetime
from typing import Annotated

import chess
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.analysis.positions import board_from_input, position_key
from app.i18n import AppError
from app.analysis.stats import position_move_stats
from app.db import get_session
from app.models.schemas import Platform, PositionMoveStatsOut, Side

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/position-moves", response_model=PositionMoveStatsOut)
def get_position_moves(
    platform: Platform,
    username: str,
    fen: Annotated[str | None, Query(description="포지션 FEN. 없으면 pgn을 쓴다.")] = None,
    pgn: Annotated[str | None, Query(description="PGN 또는 수순. 메인라인 마지막 포지션을 쓴다.")] = None,
    time_class: Annotated[
        list[str] | None, Query(description="시간 규칙(bullet/blitz/rapid/daily). 여러 번 주면 OR")
    ] = None,
    color: Annotated[Side | None, Query(description="플레이어가 이 색으로 둔 대국만")] = None,
    since: Annotated[datetime | None, Query(description="이 시각 이후(포함)에 끝난 대국만")] = None,
    until: Annotated[datetime | None, Query(description="이 시각 전(미포함)에 끝난 대국만")] = None,
    session: Session = Depends(get_session),
):
    """주어진 포지션에서 플레이어 본인과 상대들이 다음에 둔 수의 통계."""
    board = board_from_input(fen=fen, pgn=pgn)  # 잘못된 입력이면 PositionError(422)
    key = position_key(board)
    if since and until and since >= until:
        raise AppError("period_invalid")
    stats = position_move_stats(session, platform, username, key, time_class, color, since, until)
    return PositionMoveStatsOut(
        fen=board.fen(),
        position_key=key,
        side_to_move="white" if board.turn == chess.WHITE else "black",
        player=asdict(stats.player),
        opponent=asdict(stats.opponent),
    )
