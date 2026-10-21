from typing import Annotated

import chess
from fastapi import APIRouter, HTTPException, Query, status

from app.analysis.openings import get_book
from app.analysis.positions import PositionError, board_from_input
from app.models.schemas import OpeningClassificationOut

router = APIRouter(prefix="/openings", tags=["openings"])

MAX_MOVES = 400


@router.get("/classify", response_model=OpeningClassificationOut)
def classify_line(
    fen: Annotated[str | None, Query(description="시작 포지션 FEN. 없으면 초기 포지션.")] = None,
    moves: Annotated[list[str] | None, Query(description="시작 포지션부터 둔 수(UCI), 순서대로")] = None,
):
    """라인의 오프닝(이론을 벗어났으면 마지막 이론 포지션의 오프닝)과 이론으로 이어지는 다음 수."""
    try:
        board = board_from_input(fen=fen)
    except PositionError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    ucis = moves or []
    if len(ucis) > MAX_MOVES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"수는 최대 {MAX_MOVES}개까지")

    parsed = []
    b = board.copy()
    for uci in ucis:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            move = None
        if move is None or move not in b.legal_moves:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"둘 수 없는 수입니다: {uci}")
        parsed.append(move)
        b.push(move)

    result = get_book().classify(board, parsed)
    return OpeningClassificationOut(
        opening=result.opening and {"eco": result.opening.eco, "name": result.opening.name},
        in_book=result.in_book,
        plies_out_of_book=result.plies_out_of_book,
        continuations=[
            {"uci": c.uci, "san": c.san, "eco": c.opening.eco, "name": c.opening.name}
            for c in result.continuations
        ],
    )
