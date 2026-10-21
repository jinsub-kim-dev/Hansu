import chess
import pytest
from fastapi.testclient import TestClient

from app.analysis.engine import AnalysisService
from app.analysis.openings import get_book
from app.importers.jobs import ImportJobManager
from app.main import create_app


def moves(board: chess.Board, san_line: str) -> list[chess.Move]:
    b = board.copy()
    out = []
    for san in san_line.split():
        out.append(b.push_san(san))
    return out


@pytest.fixture(scope="module")
def book():
    return get_book()


def test_book_loads_all_files(book):
    assert len(book.positions) > 3000


def test_classify_ruy_lopez(book):
    board = chess.Board()
    r = book.classify(board, moves(board, "e4 e5 Nf3 Nc6 Bb5"))
    assert (r.opening.eco, r.opening.name) == ("C60", "Ruy Lopez")
    assert r.in_book and r.plies_out_of_book == 0
    assert any(c.san == "a6" for c in r.continuations)


def test_transposition_is_recognised(book):
    board = chess.Board()
    r = book.classify(board, moves(board, "c4 e6 d4 d5"))
    assert r.opening.name == "Queen's Gambit Declined"
    assert r.in_book


def test_out_of_book_keeps_last_opening(book):
    board = chess.Board()
    r = book.classify(board, moves(board, "e4 e5 Nf3 Nc6 Bb5 Qh4 Qe2 Qh5"))
    assert r.opening.name.startswith("Ruy Lopez")
    assert not r.in_book
    assert r.plies_out_of_book >= 1


def test_start_position(book):
    r = book.classify(chess.Board(), [])
    assert r.opening is None and not r.in_book and r.plies_out_of_book == 0
    assert {"e4", "d4", "c4", "Nf3"} <= {c.san for c in r.continuations}


@pytest.fixture
def client(engine):
    app = create_app(ImportJobManager({}), AnalysisService(engine, None, depth=12), init=False)
    with TestClient(app) as c:
        yield c


def test_api(client):
    body = client.get(
        "/api/openings/classify", params=[("moves", m) for m in ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"]]
    ).json()
    assert body["opening"] == {"eco": "C60", "name": "Ruy Lopez"}
    assert body["in_book"] is True
    assert {"uci": "a7a6", "san": "a6"}.items() <= next(
        c for c in body["continuations"] if c["san"] == "a6"
    ).items()

    assert client.get("/api/openings/classify", params={"moves": "e2e5"}).status_code == 422
    assert client.get("/api/openings/classify", params={"fen": "bad"}).status_code == 422
