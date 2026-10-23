import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.analysis.engine import AnalysisService
from app.auth.access import current_user_id
from app.db import get_session
from app.importers.jobs import ImportJobManager
from app.main import create_app

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
LINE = ["e2e4", "e7e5", "g1f3"]  # 흑 차례


class Login:
    user_id: int | None = None


@pytest.fixture
def login():
    return Login()


@pytest.fixture
def client(engine, login, link_user):
    app = create_app(ImportJobManager({}), AnalysisService(engine, None, depth=12), init=False)

    def session_override():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[current_user_id] = lambda: login.user_id
    login.user_id = link_user("lichess", "me")
    with TestClient(app) as c:
        yield c


def save(client, **extra):
    body = {"start_fen": START, "moves": LINE, "color": "black", "my_move": "f8c5", **extra}
    return client.post("/api/reviews", json=body)


def test_create_lookup_and_list(client):
    resp = save(client, best_move="b8c6", classification="mistake", tags=["실수", " 오프닝 ", "실수"],
                source_url="https://lichess.org/abcd1234", game_date="2026-10-20", note="Bc5는 Nxe5에 약하다")
    assert resp.status_code == 201
    r = resp.json()
    assert r["moves"] == LINE and r["color"] == "black" and r["my_move"] == "f8c5"
    assert r["tags"] == ["실수", "오프닝"]  # 공백 제거, 중복 제거
    assert [n["body"] for n in r["notes"]] == ["Bc5는 Nxe5에 약하다"]
    assert r["created_at"].endswith("Z") or "+00:00" in r["created_at"]

    # 같은 포지션은 수순이 달라도(트랜스포지션) 같은 노트로 찾는다.
    transposed = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"
    assert client.get("/api/reviews/lookup", params={"fen": transposed}).json()["id"] == r["id"]
    assert client.get("/api/reviews/lookup", params={"fen": START}).json() is None

    # 다시 보관하면 새로 만들지 않고 있는 노트를 돌려준다.
    again = save(client)
    assert again.status_code == 200 and again.json()["id"] == r["id"]
    assert [x["id"] for x in client.get("/api/reviews").json()] == [r["id"]]


def test_update_notes_and_delete(client):
    rid = save(client).json()["id"]
    r = client.patch(f"/api/reviews/{rid}", json={"reviewed": True, "my_idea": "b8c6", "tags": ["블런더"]}).json()
    assert r["reviewed_at"] and r["my_idea"] == "b8c6" and r["tags"] == ["블런더"]
    assert r["my_move"] == "f8c5"  # 보내지 않은 필드는 그대로
    r = client.patch(f"/api/reviews/{rid}", json={"reviewed": False, "my_idea": None}).json()
    assert r["reviewed_at"] is None and r["my_idea"] is None

    client.post(f"/api/reviews/{rid}/notes", json={"body": "첫 복기"})
    r = client.post(f"/api/reviews/{rid}/notes", json={"body": "다시 봄"}).json()
    assert [n["body"] for n in r["notes"]] == ["첫 복기", "다시 봄"]  # 오래된 순으로 쌓인다
    r = client.delete(f"/api/reviews/{rid}/notes/{r['notes'][0]['id']}").json()
    assert [n["body"] for n in r["notes"]] == ["다시 봄"]

    assert client.delete(f"/api/reviews/{rid}").json() == {"ok": True}
    assert client.get("/api/reviews").json() == []
    assert client.get(f"/api/reviews/{rid}").status_code == 404


def test_validation(client):
    assert save(client, my_move="e2e4").json()["code"] == "illegal_move"  # 흑 차례
    bad_line = client.post("/api/reviews", json={"start_fen": START, "moves": ["e2e5"], "color": "white"})
    assert bad_line.json()["code"] == "illegal_move"
    assert client.post("/api/reviews", json={"start_fen": "nope", "color": "white"}).json()["code"] == "invalid_fen"
    assert save(client, source_url="javascript:alert(1)").json()["code"] == "invalid_url"
    assert save(client, tags=[str(i) for i in range(11)]).json()["code"] == "too_many_tags"
    assert save(client, tags=["x" * 21]).json()["code"] == "tag_too_long"
    rid = save(client).json()["id"]
    assert client.post(f"/api/reviews/{rid}/notes", json={"body": "   "}).json()["code"] == "note_empty"
    assert client.post(f"/api/reviews/{rid}/notes", json={"body": "x" * 4001}).json()["code"] == "note_too_long"


def test_only_own_reviews(client, login, link_user):
    rid = save(client).json()["id"]
    me = login.user_id

    login.user_id = link_user("lichess", "someoneelse")
    assert client.get("/api/reviews").json() == []
    assert client.get(f"/api/reviews/{rid}").status_code == 404
    assert client.patch(f"/api/reviews/{rid}", json={"reviewed": True}).status_code == 404
    assert client.post(f"/api/reviews/{rid}/notes", json={"body": "x"}).status_code == 404
    assert client.delete(f"/api/reviews/{rid}").status_code == 404
    # 같은 포지션이라도 사용자마다 따로 보관한다.
    assert save(client).status_code == 201

    login.user_id = None
    assert client.get("/api/reviews").status_code == 401
    assert save(client).status_code == 401

    login.user_id = me
    assert len(client.get("/api/reviews").json()) == 1
