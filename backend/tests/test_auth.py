import base64
import hashlib
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.analysis.engine import AnalysisService
from app.auth.providers import ChessComOAuth, LichessOAuth
from app.db import get_session
from app.importers.base import ImportProgress
from app.importers.jobs import ImportJobManager
from app.main import create_app

# 가짜 리체스가 code 값에 따라 돌려줄 계정
ACCOUNTS = {"code-a": {"id": "testuser", "username": "TestUser"}, "code-b": {"id": "other", "username": "Other"}}


class FakeLichessOAuth:
    """리체스 OAuth 엔드포인트 흉내. PKCE(S256)를 실제로 검증한다."""

    def __init__(self):
        self.challenges: dict[str, str] = {}  # state → challenge (authorize URL에서 꺼내 둔다)
        self.revoked: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/token" and request.method == "POST":
            form = parse_qs(request.content.decode())
            verifier = form["code_verifier"][0]
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            code = form["code"][0]
            if challenge not in self.challenges.values() or code not in ACCOUNTS:
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"token_type": "Bearer", "access_token": f"tok-{code}"})
        if path == "/api/account":
            code = request.headers["Authorization"].removeprefix("Bearer tok-")
            return httpx.Response(200, json=ACCOUNTS[code])
        if path == "/api/token" and request.method == "DELETE":
            self.revoked.append(request.headers["Authorization"])
            return httpx.Response(204)
        return httpx.Response(404)


@pytest.fixture
def lichess():
    return FakeLichessOAuth()


@pytest.fixture
def started_jobs():
    return []


@pytest.fixture
def client(engine, lichess, started_jobs):
    http = httpx.Client(transport=httpx.MockTransport(lichess.handler))
    providers = {
        "lichess": LichessOAuth(http, "test-client"),
        "chesscom": ChessComOAuth(http, "", ""),
    }

    def run(username, on_progress):
        started_jobs.append(username)
        return ImportProgress()

    app = create_app(
        ImportJobManager({"lichess": run, "chesscom": run}),
        AnalysisService(engine, None, depth=12),
        providers,
        init=False,
    )

    def session_override():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = session_override
    with TestClient(app) as c:
        yield c


def start_login(client, lichess) -> str:
    resp = client.get("/api/auth/lichess/login", follow_redirects=False)
    assert resp.status_code == 302
    url = urlparse(resp.headers["location"])
    assert (url.netloc, url.path) == ("lichess.org", "/oauth")
    q = parse_qs(url.query)
    assert q["code_challenge_method"] == ["S256"]
    assert q["client_id"] == ["test-client"]
    assert q["redirect_uri"][0].endswith("/api/auth/lichess/callback")
    lichess.challenges[q["state"][0]] = q["code_challenge"][0]
    return q["state"][0]


def finish_login(client, state: str, code: str = "code-a") -> dict:
    resp = client.get(f"/api/auth/lichess/callback?code={code}&state={state}", follow_redirects=False)
    assert resp.status_code == 302
    return {k: v[0] for k, v in parse_qs(urlparse(resp.headers["location"]).query).items()}


def test_providers(client):
    body = client.get("/api/auth/providers").json()
    assert {p["platform"]: p["enabled"] for p in body} == {"lichess": True, "chesscom": False}
    assert client.get("/api/auth/chesscom/login", follow_redirects=False).status_code == 400


def test_lichess_login_links_account_and_starts_import(client, lichess, started_jobs):
    assert client.get("/api/me").json() == {"user_id": None, "accounts": []}

    back = finish_login(client, start_login(client, lichess))

    assert back["linked"] == "lichess" and back["job"]
    me = client.get("/api/me").json()
    assert me["user_id"] is not None
    assert [(a["platform"], a["username"], a["display_name"]) for a in me["accounts"]] == [
        ("lichess", "testuser", "TestUser")
    ]
    assert started_jobs == ["testuser"]  # 연결하자마자 대국 가져오기 시작
    assert lichess.revoked == ["Bearer tok-code-a"]  # 아이디 확인 뒤 토큰 폐기
    # 저장된 플레이어로도 보인다.
    assert client.get("/api/players/lichess/testuser").status_code == 200


def test_login_again_returns_same_user(client, lichess):
    finish_login(client, start_login(client, lichess))
    first = client.get("/api/me").json()["user_id"]
    client.post("/api/auth/logout")
    assert client.get("/api/me").json()["user_id"] is None

    finish_login(client, start_login(client, lichess))
    assert client.get("/api/me").json()["user_id"] == first


def test_rejects_forged_state_and_cancel(client, lichess):
    start_login(client, lichess)
    back = finish_login(client, "wrong-state")
    assert back["auth_error"] == "login_expired"  # 오류는 코드로 넘기고 프론트엔드가 번역한다
    assert client.get("/api/me").json()["user_id"] is None

    start_login(client, lichess)
    resp = client.get("/api/auth/lichess/callback?error=access_denied", follow_redirects=False)
    assert parse_qs(urlparse(resp.headers["location"]).query)["auth_error"] == ["login_cancelled"]


def test_account_owned_by_other_user_conflicts(client, lichess):
    finish_login(client, start_login(client, lichess), code="code-a")  # 사용자 1: testuser
    client.post("/api/auth/logout")
    finish_login(client, start_login(client, lichess), code="code-b")  # 사용자 2: other

    # 사용자 2로 로그인한 채 사용자 1의 계정을 연결하려 하면 막는다.
    back = finish_login(client, start_login(client, lichess), code="code-a")
    assert back["auth_error"] == "account_conflict"
    accounts = client.get("/api/me").json()["accounts"]
    assert [a["username"] for a in accounts] == ["other"]


def test_unlink(client, lichess):
    finish_login(client, start_login(client, lichess))
    assert client.delete("/api/me/accounts/lichess").json() == {"ok": True}
    assert client.get("/api/me").json()["accounts"] == []
    # 연결을 끊으면 그 계정의 대국은 더 볼 수 없다(데이터는 DB에 남는다).
    assert client.get("/api/players/lichess/testuser").status_code == 403
    assert client.get("/api/players").json() == []
    client.post("/api/auth/logout")
    assert client.delete("/api/me/accounts/lichess").status_code == 401
