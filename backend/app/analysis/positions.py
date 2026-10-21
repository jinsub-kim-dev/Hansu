"""PGN/FEN 파싱과 포지션 정규화."""

import io
from dataclasses import dataclass

import chess
import chess.pgn


class PositionError(ValueError):
    pass


def position_key(board: chess.Board) -> str:
    """수 카운터를 뺀 FEN. 같은 포지션이면 수순(트랜스포지션)과 무관하게 같은 키가 나온다.

    앙파상 칸은 실제로 앙파상이 가능할 때만 포함한다.
    """
    return " ".join(board.fen(en_passant="legal").split(" ")[:4])


@dataclass(frozen=True)
class MoveRecord:
    ply: int
    position_key: str
    color: str
    uci: str
    san: str


def extract_moves(pgn: str) -> list[MoveRecord]:
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None:
        return []
    board = game.board()
    records: list[MoveRecord] = []
    for ply, move in enumerate(game.mainline_moves(), start=1):
        records.append(
            MoveRecord(
                ply=ply,
                position_key=position_key(board),
                color="white" if board.turn == chess.WHITE else "black",
                uci=move.uci(),
                san=board.san(move),
            )
        )
        board.push(move)
    return records


def board_from_input(fen: str | None = None, pgn: str | None = None) -> chess.Board:
    """FEN이나 PGN(메인라인의 마지막 포지션)으로 보드를 만든다."""
    if fen:
        try:
            board = chess.Board(fen.strip())
        except ValueError as exc:
            raise PositionError(f"잘못된 FEN입니다: {exc}") from exc
        if not board.is_valid():
            raise PositionError("불가능한 포지션입니다.")
        return board
    if pgn:
        text = pgn.strip()
        # "1. e4 e5 2. Nf3"처럼 헤더 없이 수순만 준 경우도 받는다.
        game = chess.pgn.read_game(io.StringIO(text))
        if game is None or game.errors:
            raise PositionError("PGN을 해석할 수 없습니다.")
        board = game.board()
        for move in game.mainline_moves():
            board.push(move)
        return board
    return chess.Board()
