import chess
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.analysis.engine import AnalysisService, Evaluation, StockfishAnalyzer, classify, win_chance
from app.config import settings
from app.db import get_session
from app.importers.jobs import ImportJobManager
from app.main import create_app

START = chess.STARTING_FEN


class FakeAnalyzer:
    """수마다 정해 둔 점수를 돌려준다(둘 차례 기준). 호출을 기록한다."""

    SCORES = {"e2e4": 30, "d2d4": 25, "f2f3": -60, "g2g4": -150}

    def __init__(self):
        self.calls: list[str] = []
        self.closed = False

    def lines(self, board, multipv):
        self.calls.append("lines")
        if board.turn == chess.WHITE:
            out = [
                Evaluation(cp=30, pv=("e2e4", "e7e5", "g1f3")),
                Evaluation(cp=25, pv=("d2d4", "d7d5")),
                Evaluation(cp=20, pv=("g1f3",)),
            ]
        else:
            out = [Evaluation(cp=30, pv=("e7e5",))]
        return out[:multipv]

    def move(self, board, move):
        self.calls.append(move.uci())
        return Evaluation(cp=self.SCORES.get(move.uci(), 0))

    def close(self):
        self.closed = True


@pytest.fixture
def analyzer():
    return FakeAnalyzer()


@pytest.fixture
def service(engine, analyzer):
    return AnalysisService(engine, lambda: analyzer, depth=12, multipv=3, start_worker=False)


@pytest.fixture
def client(engine, service):
    app = create_app(ImportJobManager({}), service, init=False)

    def session_override():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = session_override
    with TestClient(app) as c:
        yield c


def get_eval(client, fen=START, moves=()):
    params = [("fen", fen)] + [("moves", m) for m in moves]
    return client.get("/api/analysis/position", params=params)


def test_classify_thresholds():
    assert classify(30, 30, is_best=True)[1] == "best"
    assert classify(30, 25, is_best=False)[1] == "best"
    assert classify(30, 0, is_best=False)[1] == "good"
    assert classify(30, -60, is_best=False)[1] == "inaccuracy"
    assert classify(0, -120, is_best=False)[1] == "mistake"
    assert classify(0, -300, is_best=False)[1] == "blunder"
    # 이미 크게 이긴 포지션에서는 같은 cp 손실도 덜 중요하다.
    assert classify(1500, 1200, is_best=False)[1] == "best"
    assert win_chance(0) == 0


def test_pending_then_done(client, service, analyzer):
    first = get_eval(client, moves=["e2e4", "g2g4"]).json()
    assert first["status"] == "pending"
    assert first["moves"] == []

    service.drain()

    done = get_eval(client, moves=["e2e4", "g2g4"]).json()
    assert done["status"] == "done"
    assert done["position"]["best_san"] == "e4"
    assert done["position"]["pv_san"] == ["e4", "e5", "Nf3"]
    by_uci = {m["uci"]: m for m in done["moves"]}
    assert by_uci["e2e4"]["classification"] == "best"
    assert by_uci["g2g4"]["san"] == "g4"
    assert by_uci["g2g4"]["cp_loss"] == 180
    assert by_uci["g2g4"]["classification"] == "blunder"
    # 최선 수는 포지션 분석 결과를 재사용해 따로 분석하지 않는다.
    assert analyzer.calls == ["lines", "g2g4"]
    lines = done["position"]["lines"]
    assert [(l["san"], l["cp"]) for l in lines] == [("e4", 30), ("d4", 25), ("Nf3", 20)]
    assert lines[1]["pv_san"] == ["d4", "d5"]


def test_results_are_cached(client, service, analyzer):
    get_eval(client, moves=["d2d4"])
    service.drain()
    analyzer.calls.clear()

    # d4는 엔진 후보 수라 따로 분석하지 않고 바로 done이다.
    assert get_eval(client, moves=["d2d4"]).json()["status"] == "done"
    service.drain()
    assert analyzer.calls == []

    # 새 수만 추가로 분석한다.
    assert get_eval(client, moves=["d2d4", "f2f3"]).json()["status"] == "pending"
    service.drain()
    assert analyzer.calls == ["f2f3"]


def test_scores_are_reported_from_white(client, service):
    fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"  # 흑 차례
    get_eval(client, fen=fen)
    service.drain()
    body = get_eval(client, fen=fen).json()
    # 분석기는 둘 차례(흑) 기준 +30을 줬으므로 백 기준은 -30.
    assert body["position"]["cp"] == -30


def test_rejects_illegal_moves(client):
    assert get_eval(client, moves=["e2e5"]).status_code == 422
    assert get_eval(client, moves=["zz"]).status_code == 422
    assert get_eval(client, fen="bad").status_code == 422


def test_failed_analysis_is_reported(client, service, analyzer):
    def boom(board):
        raise RuntimeError("engine died")

    analyzer.lines = lambda board, multipv: boom(board)
    get_eval(client)
    service.drain()
    body = get_eval(client).json()
    assert body["status"] == "failed"
    assert "engine died" in body["message"]
    # 재시도 대기 중에는 다시 분석하지 않는다.
    analyzer.calls.clear()
    service.drain()
    assert analyzer.calls == []


def test_unavailable_without_engine(engine):
    app = create_app(ImportJobManager({}), AnalysisService(engine, None, depth=12), init=False)
    with TestClient(app) as c:
        assert get_eval(c).json()["status"] == "unavailable"


@pytest.mark.skipif(settings.resolve_stockfish() is None, reason="Stockfish가 설치돼 있지 않음")
def test_real_stockfish_smoke():
    sf = StockfishAnalyzer(settings.resolve_stockfish(), depth=8)
    try:
        board = chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1")  # Ra8#
        lines = sf.lines(board, 3)
        assert len(lines) == 3
        assert lines[0].pv[0] == "a1a8"
        assert lines[0].mate == 1
        assert lines[1].cp < lines[0].cp
        worse = sf.move(board, chess.Move.from_uci("h2h3"))
        assert worse.cp < lines[0].cp
    finally:
        sf.close()
