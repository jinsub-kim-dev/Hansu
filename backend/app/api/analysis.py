from typing import Annotated

import chess
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlmodel import Session

from app.analysis.engine import AnalysisService, classify
from app.analysis.positions import PositionError, board_from_input, position_key
from app.db import get_session
from app.models.schemas import CandidateLineOut, EngineLineOut, MoveEvalOut, PositionEvalOut

router = APIRouter(prefix="/analysis", tags=["analysis"])

MAX_MOVES = 30
PV_LENGTH = 8


def _pv_san(board: chess.Board, pv: list[str]) -> list[str]:
    """UCI 수순을 SAN으로. 둘 수 없는 수가 나오면 거기서 멈춘다."""
    b = board.copy()
    out = []
    for u in pv[:PV_LENGTH]:
        mv = chess.Move.from_uci(u)
        if mv not in b.legal_moves:
            break
        out.append(b.san(mv))
        b.push(mv)
    return out


def get_analysis_service(request: Request) -> AnalysisService:
    return request.app.state.analysis_service


@router.get("/position", response_model=PositionEvalOut)
def get_position_eval(
    fen: Annotated[str | None, Query(description="포지션 FEN. 없으면 pgn을 쓴다.")] = None,
    pgn: str | None = None,
    moves: Annotated[list[str] | None, Query(description="평가할 수(UCI). 여러 번 줄 수 있다.")] = None,
    service: AnalysisService = Depends(get_analysis_service),
    session: Session = Depends(get_session),
):
    """포지션의 엔진 평가(최선 수)와 주어진 수들의 평가.

    결과가 캐시에 없으면 분석을 예약하고 status=pending을 돌려준다. 클라이언트는 done이 될 때까지 폴링한다.
    """
    try:
        board = board_from_input(fen=fen, pgn=pgn)
    except PositionError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    ucis = list(dict.fromkeys(moves or []))
    if len(ucis) > MAX_MOVES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"수는 최대 {MAX_MOVES}개까지")
    for uci in ucis:
        try:
            ok = chess.Move.from_uci(uci) in board.legal_moves
        except ValueError:
            ok = False
        if not ok:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"둘 수 없는 수입니다: {uci}")

    if not service.available:
        return PositionEvalOut(
            status="unavailable",
            message="Stockfish를 찾을 수 없습니다. STOCKFISH_PATH 환경 변수를 설정하세요.",
        )
    if board.is_game_over():
        return PositionEvalOut(status="done", message="대국이 끝난 포지션입니다.")

    key = position_key(board)
    pos_row, move_rows, line_rows = service.cached(session, key, ucis)
    complete = pos_row is not None and all(u in move_rows for u in ucis)
    if not complete:
        service.request(key, board.fen(), [u for u in ucis if u not in move_rows])

    sign = 1 if board.turn == chess.WHITE else -1  # 둘 차례 기준 → 백 기준

    def white_mate(m: int | None) -> int | None:
        return None if m is None else sign * m

    position = None
    best_uci = None
    if pos_row is not None:
        pv = pos_row.pv.split() if pos_row.pv else []
        best_uci = pv[0] if pv else None
        pv_san = _pv_san(board, pv)
        position = EngineLineOut(
            best_uci=best_uci,
            best_san=pv_san[0] if pv_san else None,
            cp=sign * pos_row.cp,
            mate=white_mate(pos_row.mate),
            pv_san=pv_san,
            lines=[
                CandidateLineOut(
                    uci=r.uci,
                    san=line_san[0],
                    cp=sign * r.cp,
                    mate=white_mate(r.mate),
                    pv_san=line_san,
                )
                for r in line_rows
                if (line_san := _pv_san(board, r.pv.split()))
            ],
        )

    out_moves = []
    for uci in ucis:
        row = move_rows.get(uci)
        if row is None:
            continue
        loss = cls = cp_loss = None
        if pos_row is not None:
            loss, cls = classify(pos_row.cp, row.cp, is_best=uci == best_uci)
            cp_loss = max(0, pos_row.cp - row.cp)
        out_moves.append(
            MoveEvalOut(
                uci=uci,
                san=board.san(chess.Move.from_uci(uci)),
                cp=sign * row.cp,
                mate=white_mate(row.mate),
                cp_loss=cp_loss,
                win_chance_loss=loss,
                classification=cls,
            )
        )

    if complete:
        state, message = "done", None
    elif (err := service.error(key)) is not None:
        state, message = "failed", err
    else:
        state, message = "pending", None
    return PositionEvalOut(
        status=state, message=message, depth=service.depth, position=position, moves=out_moves
    )
