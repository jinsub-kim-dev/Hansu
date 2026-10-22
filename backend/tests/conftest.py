import os

# backend/.env(실제 DB 주소)를 읽기 전에 테스트용 주소를 정해, 테스트가 외부 DB에 닿지 않게 한다.
os.environ["DATABASE_URL"] = "sqlite://"

import json
from pathlib import Path

import httpx
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine

from app.db import init_db
from app.importers.chesscom import ChessComClient

FIXTURES = Path(__file__).parent / "fixtures"

ROUTES = {
    "/pub/player/testuser/games/archives": "chesscom_archives.json",
    "/pub/player/testuser/games/2026/08": "chesscom_2026_08.json",
    "/pub/player/testuser/games/2026/10": "chesscom_2026_10.json",
}


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    init_db(engine)
    return engine


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s


class FakeChessCom:
    """저장해 둔 fixture로 체스닷컴 API 응답을 흉내 낸다. 요청 경로를 기록한다."""

    def __init__(self):
        self.requests: list[str] = []
        self.status_overrides: dict[str, list[int]] = {}
        self.extra_games: dict[str, list[dict]] = {}  # 경로별로 fixture 뒤에 덧붙일 대국

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.requests.append(path)
        overrides = self.status_overrides.get(path)
        if overrides:
            return httpx.Response(overrides.pop(0))
        if path not in ROUTES:
            return httpx.Response(404, json={"code": 0, "message": "not found"})
        body = load_fixture(ROUTES[path])
        if path in self.extra_games:
            body["games"] = body["games"] + self.extra_games[path]
        return httpx.Response(200, json=body)

    def client(self) -> ChessComClient:
        http = httpx.Client(transport=httpx.MockTransport(self.handler))
        return ChessComClient(http, retry_wait=0, sleep=lambda _: None)


@pytest.fixture
def fake_chesscom():
    return FakeChessCom()
