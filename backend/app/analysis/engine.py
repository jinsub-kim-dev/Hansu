"""Stockfish(UCI) 엔진 분석.

분석은 오래 걸리므로 HTTP 요청 안에서 돌리지 않는다. 요청은 AnalysisService 큐에 넣고
작업자 스레드 하나가 엔진 프로세스 하나로 차례대로 처리해 결과를 EngineEval에 캐시한다.
API는 캐시를 읽어 바로 응답하고, 아직 없으면 pending을 돌려주며 프론트엔드가 폴링한다.
"""

import logging
import math
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Protocol

import chess
import chess.engine
from sqlalchemy import Engine
from sqlmodel import Session, or_, select

from app.models.db import EngineEval

log = logging.getLogger(__name__)

MATE_CP = 10000
POSITION_ROW = ""  # EngineEval.uci가 이 값이면 포지션(최선 수) 평가
RETRY_AFTER_ERROR_S = 30.0  # 분석이 실패한 포지션은 이 시간 동안 다시 시도하지 않는다


@dataclass(frozen=True)
class Evaluation:
    cp: int  # 둘 차례인 쪽 기준. 메이트는 ±(MATE_CP - 수)
    mate: int | None = None
    pv: tuple[str, ...] = ()


class Analyzer(Protocol):
    def lines(self, board: chess.Board, multipv: int) -> list[Evaluation]: ...
    def move(self, board: chess.Board, move: chess.Move) -> Evaluation: ...
    def close(self) -> None: ...


def _to_eval(info: chess.engine.InfoDict, board: chess.Board) -> Evaluation:
    score = info["score"].pov(board.turn)
    return Evaluation(
        cp=score.score(mate_score=MATE_CP),
        mate=score.mate(),
        pv=tuple(m.uci() for m in info.get("pv", [])),
    )


class StockfishAnalyzer:
    def __init__(self, path: str, depth: int, threads: int = 1, hash_mb: int = 128):
        self.path = path
        self.limit = chess.engine.Limit(depth=depth)
        self.options = {"Threads": threads, "Hash": hash_mb}
        self._engine: chess.engine.SimpleEngine | None = None

    def _get(self) -> chess.engine.SimpleEngine:
        if self._engine is None:
            self._engine = chess.engine.SimpleEngine.popen_uci(self.path)
            self._engine.configure(self.options)
        return self._engine

    def _analyse(self, board: chess.Board, **kwargs) -> chess.engine.InfoDict:
        try:
            return self._get().analyse(board, self.limit, **kwargs)
        except chess.engine.EngineTerminatedError:
            self._engine = None  # 다음 요청에서 다시 띄운다.
            raise

    def lines(self, board: chess.Board, multipv: int) -> list[Evaluation]:
        """엔진 후보 수 상위 multipv개. 좋은 순."""
        infos = self._analyse(board, multipv=multipv)
        return [_to_eval(info, board) for info in infos if info.get("pv")]

    def move(self, board: chess.Board, move: chess.Move) -> Evaluation:
        # root_moves로 이 수만 탐색하면 점수는 수를 두기 전(=수를 둔 쪽) 기준으로 나온다.
        return _to_eval(self._analyse(board, root_moves=[move]), board)

    def close(self) -> None:
        if self._engine is not None:
            self._engine.quit()
            self._engine = None


def win_chance(cp: int) -> float:
    """centipawn을 [-1, 1] 범위의 기대 승률로 바꾼다 (Lichess와 같은 식)."""
    return 2 / (1 + math.exp(-0.00368208 * cp)) - 1


def classify(best_cp: int, move_cp: int, is_best: bool) -> tuple[float, str]:
    """승률 손실과 분류(best/good/inaccuracy/mistake/blunder)."""
    loss = max(0.0, win_chance(best_cp) - win_chance(move_cp)) / 2  # 0~1
    if is_best or loss < 0.01:
        return loss, "best"
    if loss < 0.05:
        return loss, "good"
    if loss < 0.10:
        return loss, "inaccuracy"
    if loss < 0.15:
        return loss, "mistake"
    return loss, "blunder"


@dataclass
class _Request:
    fen: str
    ucis: set[str] = field(default_factory=set)


class AnalysisService:
    def __init__(
        self,
        db_engine: Engine,
        analyzer_factory: Callable[[], Analyzer] | None,
        depth: int,
        multipv: int = 3,
        start_worker: bool = True,
    ):
        self.db_engine = db_engine
        self.depth = depth
        self.multipv = multipv
        self._factory = analyzer_factory
        self._analyzer: Analyzer | None = None
        self._pending: dict[str, _Request] = {}  # position_key → 요청 (들어온 순서)
        self._errors: dict[str, tuple[float, str]] = {}  # key → (실패 시각, 메시지)
        self._cond = threading.Condition()
        self._stopped = False
        self._thread: threading.Thread | None = None
        if analyzer_factory and start_worker:
            self._thread = threading.Thread(target=self._loop, name="engine-worker", daemon=True)
            self._thread.start()

    @property
    def available(self) -> bool:
        return self._factory is not None

    # --- 조회 / 요청 -------------------------------------------------------

    def cached(
        self, session: Session, key: str, ucis: Iterable[str]
    ) -> tuple[EngineEval | None, dict[str, EngineEval], list[EngineEval]]:
        """(포지션 행, 요청한 수의 행, 엔진 후보 수 행[순위순]).

        포지션 행이 없거나 후보 수 분석 전에 만들어진 행(rank 없음)이면 포지션 행은 None.
        """
        wanted = {POSITION_ROW, *ucis}
        rows = session.exec(
            select(EngineEval).where(
                EngineEval.position_key == key,
                EngineEval.depth == self.depth,
                or_(EngineEval.uci.in_(wanted), EngineEval.rank.is_not(None)),
            )
        ).all()
        by_uci = {r.uci: r for r in rows}
        position = by_uci.pop(POSITION_ROW, None)
        if position is not None and position.rank is None:
            position = None
        lines = sorted((r for r in by_uci.values() if r.rank), key=lambda r: r.rank)
        wanted_rows = {u: r for u, r in by_uci.items() if u in wanted}
        return position, wanted_rows, lines

    def request(self, key: str, fen: str, ucis: Iterable[str]) -> None:
        with self._cond:
            if self.error(key):
                return
            req = self._pending.setdefault(key, _Request(fen=fen))
            req.ucis.update(ucis)
            self._cond.notify()

    def error(self, key: str) -> str | None:
        """최근에 실패한 분석의 오류 메시지. 재시도 대기 시간이 지나면 None."""
        failed = self._errors.get(key)
        if failed is None or time.monotonic() - failed[0] > RETRY_AFTER_ERROR_S:
            return None
        return failed[1]

    # --- 작업자 -------------------------------------------------------------

    def _next(self, block: bool) -> tuple[str, _Request] | None:
        with self._cond:
            while not self._pending and not self._stopped and block:
                self._cond.wait()
            if self._stopped or not self._pending:
                return None
            key = next(iter(self._pending))
            return key, self._pending.pop(key)

    def _loop(self) -> None:
        while (item := self._next(block=True)) is not None:
            self._run(*item)

    def drain(self) -> None:
        """대기 중인 요청을 현재 스레드에서 모두 처리한다 (테스트용)."""
        while (item := self._next(block=False)) is not None:
            self._run(*item)

    def _run(self, key: str, req: _Request) -> None:
        try:
            self._process(key, req)
            self._errors.pop(key, None)
        except Exception as exc:
            log.exception("엔진 분석 실패: %s", key)
            self._errors[key] = (time.monotonic(), f"엔진 분석에 실패했습니다: {exc}")

    def _process(self, key: str, req: _Request) -> None:
        if self._analyzer is None:
            assert self._factory is not None
            self._analyzer = self._factory()
        board = chess.Board(req.fen)
        with Session(self.db_engine) as session:
            position, done, _ = self.cached(session, key, req.ucis)
            if position is None:
                lines = self._analyzer.lines(board, self.multipv)
                # 포지션 평가는 1순위 후보 수의 평가와 같다.
                self._upsert(session, key, POSITION_ROW, lines[0] if lines else Evaluation(0), len(lines))
                for rank, line in enumerate(lines, start=1):
                    # 후보 수의 평가는 그 수만 따로 분석한 결과로도 쓴다.
                    done[line.pv[0]] = self._upsert(session, key, line.pv[0], line, rank)
                session.commit()
            for uci in sorted(req.ucis - done.keys()):
                move = chess.Move.from_uci(uci)
                if move not in board.legal_moves:
                    continue
                self._upsert(session, key, uci, self._analyzer.move(board, move), None)
                session.commit()  # 끝난 수부터 바로 보이게 한다.

    def _upsert(
        self, session: Session, key: str, uci: str, ev: Evaluation, rank: int | None
    ) -> EngineEval:
        row = session.exec(
            select(EngineEval).where(
                EngineEval.position_key == key, EngineEval.uci == uci, EngineEval.depth == self.depth
            )
        ).first() or EngineEval(position_key=key, uci=uci, depth=self.depth, cp=0)
        row.cp, row.mate, row.pv, row.rank = ev.cp, ev.mate, " ".join(ev.pv), rank
        session.add(row)
        return row

    def shutdown(self) -> None:
        with self._cond:
            self._stopped = True
            self._cond.notify_all()
        if self._thread:
            self._thread.join(timeout=5)
        if self._analyzer:
            self._analyzer.close()
