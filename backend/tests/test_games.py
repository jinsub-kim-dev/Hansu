from datetime import UTC, datetime

import chess
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.analysis.engine import AnalysisService
from app.auth.access import current_user_id
from app.db import get_session
from app.importers.chesscom import import_player
from app.importers.jobs import ImportJobManager
from app.main import create_app
from app.models.db import Game

NOW = datetime(2026, 10, 19, tzinfo=UTC)


class Login:
    user_id: int | None = None


@pytest.fixture
def login():
    return Login()


@pytest.fixture
def client(engine, fake_chesscom, login, link_user):
    import_player(engine, "testuser", fake_chesscom.client(), now=lambda: NOW)
    app = create_app(ImportJobManager({}), AnalysisService(engine, None, depth=12), init=False)

    def session_override():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[current_user_id] = lambda: login.user_id
    login.user_id = link_user("chesscom", "testuser")
    with TestClient(app) as c:
        yield c


def outcome(g: Game) -> str:
    if g.result == "1/2-1/2":
        return "draw"
    return "win" if (g.result == "1-0") == (g.white == "testuser") else "loss"


def test_list_recent_games(client, session):
    games = session.exec(select(Game).where(Game.platform == "chesscom")).all()
    body = client.get("/api/players/chesscom/TestUser/games").json()
    assert body["total"] == len(games) > 0
    ends = [g["end_time"] for g in body["games"]]
    assert ends == sorted(ends, reverse=True)  # 최근에 끝난 순
    first = body["games"][0]
    assert first["me"].lower() == "testuser" and first["opponent"]
    assert first["plies"] > 0 and first["url"]
    assert any(g["opening"] for g in body["games"])  # 오프닝 이름을 붙인다

    # 결과·색 필터는 내 기준이다.
    for want in ("win", "draw", "loss"):
        got = client.get("/api/players/chesscom/testuser/games", params={"outcome": want}).json()
        assert got["total"] == sum(outcome(g) == want for g in games)
        assert all(g["outcome"] == want for g in got["games"])
    black = client.get("/api/players/chesscom/testuser/games", params={"color": "black"}).json()
    assert black["total"] == sum(g.black == "testuser" for g in games)

    # 페이지 나누기
    page = client.get("/api/players/chesscom/testuser/games", params={"limit": 2, "offset": 1}).json()
    assert [g["id"] for g in page["games"]] == [g["id"] for g in body["games"][1:3]]


def test_game_detail_replays(client):
    gid = client.get("/api/players/chesscom/testuser/games").json()["games"][0]["id"]
    game = client.get(f"/api/games/{gid}").json()
    board = chess.Board(game["start_fen"])
    for uci in game["moves"]:
        board.push_uci(uci)  # 둘 수 없는 수가 있으면 예외
    assert len(game["moves"]) == game["plies"] and game["pgn"].startswith("[")


def test_only_linked_accounts(client, login, link_user):
    gid = client.get("/api/players/chesscom/testuser/games").json()["games"][0]["id"]
    login.user_id = link_user("chesscom", "someoneelse")
    assert client.get("/api/players/chesscom/testuser/games").status_code == 403
    assert client.get(f"/api/games/{gid}").status_code == 404
    login.user_id = None
    assert client.get("/api/players/chesscom/testuser/games").status_code == 401
    assert client.get(f"/api/games/{gid}").status_code == 401
