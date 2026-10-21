"""오프닝 분류. lichess-org/chess-openings(CC0)의 ECO·이름·수순 목록을 포지션 키로 색인한다.

수순이 아니라 포지션으로 찾으므로 트랜스포지션도 같은 오프닝으로 인식한다.
"""

import csv
import io
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import chess
import chess.pgn

from app.analysis.positions import position_key

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "openings"


@dataclass(frozen=True)
class Opening:
    eco: str
    name: str


@dataclass(frozen=True)
class Continuation:
    uci: str
    san: str
    opening: Opening


@dataclass
class LineClassification:
    opening: Opening | None  # 수순에서 마지막으로 지나간 이론 포지션의 오프닝
    in_book: bool  # 현재 포지션 자체가 이론 포지션인지
    plies_out_of_book: int  # 마지막 이론 포지션 뒤로 둔 수 (이론 안이면 0)
    continuations: list[Continuation] = field(default_factory=list)  # 이론으로 이어지는 다음 수


class OpeningBook:
    def __init__(self, positions: dict[str, Opening]):
        self.positions = positions

    @classmethod
    def from_tsv(cls, texts: list[str]) -> "OpeningBook":
        positions: dict[str, Opening] = {}
        for text in texts:
            for row in csv.DictReader(io.StringIO(text), delimiter="\t"):
                game = chess.pgn.read_game(io.StringIO(row["pgn"]))
                if game is None:
                    continue
                board = game.board()
                for move in game.mainline_moves():
                    board.push(move)
                # 같은 포지션에 이름이 여럿이면 먼저 나온(파일 순서상 더 일반적인) 이름을 쓴다.
                positions.setdefault(position_key(board), Opening(row["eco"], row["name"]))
        return cls(positions)

    @classmethod
    def load(cls, data_dir: Path = DATA_DIR) -> "OpeningBook":
        files = sorted(data_dir.glob("*.tsv"))
        return cls.from_tsv([f.read_text(encoding="utf-8") for f in files])

    def get(self, board: chess.Board) -> Opening | None:
        return self.positions.get(position_key(board))

    def classify(self, board: chess.Board, moves: list[chess.Move]) -> LineClassification:
        """board에서 moves를 차례로 둔 라인을 분류한다. moves는 모두 둘 수 있는 수여야 한다."""
        b = board.copy()
        opening = self.get(b)
        since = 0
        for move in moves:
            b.push(move)
            if found := self.get(b):
                opening, since = found, 0
            elif opening:
                since += 1
        continuations = []
        for move in b.legal_moves:
            b.push(move)
            found = self.get(b)
            b.pop()
            if found:
                continuations.append(Continuation(move.uci(), b.san(move), found))
        continuations.sort(key=lambda c: c.san)
        return LineClassification(
            opening=opening,
            in_book=self.get(b) is not None,
            plies_out_of_book=since,
            continuations=continuations,
        )


@lru_cache(maxsize=1)
def get_book() -> OpeningBook:
    return OpeningBook.load()
