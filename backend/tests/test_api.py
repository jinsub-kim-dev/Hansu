from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.analysis.engine import AnalysisService
from app.auth.access import current_user_id
from app.db import get_session
from app.importers.chesscom import import_player
from app.importers.jobs import ImportJobManager
from app.main import create_app

NOW = datetime(2026, 10, 19, tzinfo=UTC)


@pytest.fixture
def client(engine, fake_chesscom, link_user):
    def run(username, on_progress):
        return import_player(
            engine, username, fake_chesscom.client(), on_progress, now=lambda: NOW
        )

    service = AnalysisService(engine, None, depth=12)
    app = create_app(ImportJobManager({"chesscom": run}), service, init=False)

    def session_override():
        with Session(engine) as s:
            yield s

    # 로그인한 사용자가 testuser·nobody 계정을 연결했다고 둔다.
    user_id = link_user("chesscom", "testuser", "nobody")
    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[current_user_id] = lambda: user_id
    with TestClient(app) as c:
        yield c


def test_import_then_query(client):
    resp = client.post("/api/players/chesscom/TestUser/import")
    assert resp.status_code == 202
    job_id = resp.json()["id"]

    # TestClient는 백그라운드 작업을 응답 직후 끝까지 실행한다.
    job = client.get(f"/api/import-jobs/{job_id}").json()
    assert job["status"] == "done", job
    assert job["progress"]["games_added"] == 6

    summary = client.get("/api/players/chesscom/testuser").json()
    assert summary["total_games"] == 6
    assert summary["display_name"] == "TestUser"

    players = client.get("/api/players").json()
    assert [(p["username"], p["total_games"]) for p in players] == [("testuser", 6)]
    assert players[0]["last_game_at"].startswith("2026-10-21")

    assert client.get("/api/import-settings").json() == {"history_years": 3}

    stats = client.get(
        "/api/stats/position-moves",
        params={"platform": "chesscom", "username": "testuser", "pgn": "1. e4"},
    ).json()
    assert stats["side_to_move"] == "black"
    assert stats["player"]["moves"][0]["san"] == "e5"
    assert {m["uci"] for m in stats["opponent"]["moves"]} == {"e7e5", "c7c5"}


def test_time_class_filter_accepts_multiple_values(client):
    client.post("/api/players/chesscom/testuser/import")
    start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    params = [("platform", "chesscom"), ("username", "testuser"), ("fen", start)]
    rapid = client.get("/api/stats/position-moves", params=params + [("time_class", "rapid")]).json()
    assert rapid["player"]["total"] + rapid["opponent"]["total"] == 2
    both = client.get(
        "/api/stats/position-moves",
        params=params + [("time_class", "rapid"), ("time_class", "blitz")],
    ).json()
    assert both["player"]["total"] + both["opponent"]["total"] == 6


def test_period_filter_api(client):
    client.post("/api/players/chesscom/testuser/import")
    start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    params = {"platform": "chesscom", "username": "testuser", "fen": start}
    body = client.get(
        "/api/stats/position-moves", params={**params, "since": "2026-09-01T00:00:00+09:00"}
    ).json()
    assert body["player"]["total"] + body["opponent"]["total"] == 2
    bad = client.get(
        "/api/stats/position-moves",
        params={**params, "since": "2026-10-01T00:00:00Z", "until": "2026-09-01T00:00:00Z"},
    )
    assert bad.status_code == 422


def test_import_unknown_player_reports_error(client):
    job_id = client.post("/api/players/chesscom/nobody/import").json()["id"]
    job = client.get(f"/api/import-jobs/{job_id}").json()
    assert job["status"] == "error"
    assert "찾을 수 없습니다" in job["error"]


def test_invalid_input(client):
    assert client.post("/api/players/chesscom/bad%20name/import").status_code == 422
    assert client.post("/api/players/unknownsite/someone/import").status_code == 422
    assert client.post("/api/players/lichess/x/import").status_code == 422  # 리체스 아이디는 2자 이상
    assert client.get("/api/import-jobs/nope").status_code == 404
    assert client.get("/api/players/chesscom/nobody").status_code == 404  # 연결했지만 아직 안 가져옴
    assert client.get("/api/players/chesscom/neverimported").status_code == 403  # 연결 안 한 계정
    resp = client.get(
        "/api/stats/position-moves",
        params={"platform": "chesscom", "username": "testuser", "fen": "garbage"},
    )
    assert resp.status_code == 422


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_import_rate_limit(client):
    from app.ratelimit import RateLimiter

    client.app.state.import_limiter = RateLimiter(2, 3600)
    assert client.post("/api/players/chesscom/testuser/import").status_code in (200, 202)
    assert client.post("/api/players/chesscom/testuser/import").status_code in (200, 202)
    resp = client.post("/api/players/chesscom/testuser/import", headers={"Accept-Language": "en"})
    assert resp.status_code == 429
    assert resp.json()["code"] == "too_many_imports"


def test_only_linked_accounts_are_visible(client, link_user):
    client.post("/api/players/chesscom/testuser/import")
    other = link_user("chesscom", "someoneelse")
    params = {"platform": "chesscom", "username": "testuser", "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}

    # 다른 사용자: 남의 계정은 목록에도 없고, 조회·가져오기·작업 조회 모두 막힌다.
    job_id = client.post("/api/players/chesscom/testuser/import").json()["id"]
    client.app.dependency_overrides[current_user_id] = lambda: other
    assert client.get("/api/players").json() == []
    assert client.get("/api/players/chesscom/testuser").status_code == 403
    resp = client.get("/api/stats/position-moves", params=params)
    assert (resp.status_code, resp.json()["code"]) == (403, "account_not_linked")
    assert client.post("/api/players/chesscom/testuser/import").status_code == 403
    assert client.get(f"/api/import-jobs/{job_id}").status_code == 404

    # 로그인하지 않으면 401.
    client.app.dependency_overrides[current_user_id] = lambda: None
    assert client.get("/api/players").json() == []
    assert client.get("/api/stats/position-moves", params=params).status_code == 401
    assert client.post("/api/players/chesscom/testuser/import").status_code == 401
