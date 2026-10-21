import json
from datetime import UTC, datetime

import httpx
import pytest
from sqlmodel import Session, select

from app.analysis.positions import board_from_input, position_key
from app.analysis.stats import position_move_stats
from app.importers.base import ImporterError, PlayerNotFound
from app.importers.lichess import LichessClient, import_player, parse_game
from app.models.db import Game, Player
from tests.conftest import FIXTURES

NOW = datetime(2026, 6, 1, tzinfo=UTC)  # 3년 전(2023-06-01)부터면 fixture 대국이 모두 들어간다


def fixture_games() -> list[dict]:
    text = (FIXTURES / "lichess_games.ndjson").read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


class FakeLichess:
    """저장해 둔 NDJSON으로 리체스 API를 흉내 낸다. since(시작 시각) 필터와 정렬을 서버처럼 적용한다."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.games = fixture_games()
        self.status_overrides: dict[str, list[int]] = {}
        self.sleeps: list[float] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if self.status_overrides.get(path):
            return httpx.Response(self.status_overrides[path].pop(0))
        if path == "/api/user/testuser":
            return httpx.Response(200, content=(FIXTURES / "lichess_user.json").read_bytes())
        if path == "/api/games/user/testuser":
            since = int(request.url.params.get("since", 0))
            games = sorted((g for g in self.games if g["createdAt"] >= since), key=lambda g: g["createdAt"])
            body = "".join(json.dumps(g) + "\n" for g in games)
            return httpx.Response(200, content=body.encode(), headers={"Content-Type": "application/x-ndjson"})
        return httpx.Response(404)

    def client(self) -> LichessClient:
        http = httpx.Client(transport=httpx.MockTransport(self.handler))
        return LichessClient(http, sleep=self.sleeps.append)

    def game_requests(self) -> list[httpx.Request]:
        return [r for r in self.requests if r.url.path.startswith("/api/games/")]


@pytest.fixture
def fake():
    return FakeLichess()


def test_parse_game():
    raws = {g["id"]: g for g in fixture_games()}

    blitz = parse_game(raws["wsAN8bXO"])
    assert blitz.platform == "lichess"
    assert (blitz.white, blitz.black, blitz.result) == ("testuser", "opp1", "1-0")
    assert blitz.time_class == "blitz"
    assert blitz.url == "https://lichess.org/wsAN8bXO"
    assert blitz.end_time == datetime.fromtimestamp(raws["wsAN8bXO"]["lastMoveAt"] / 1000, UTC)

    corr = parse_game(raws["5R5vsbuD"])
    assert corr.time_class == "daily"  # 통신 체스 → 체스닷컴의 일일 체스와 같은 분류

    ai = parse_game(raws["ai000001"])
    assert (ai.white, ai.result) == ("lichess-ai-3", "1/2-1/2")

    assert parse_game(raws["var00001"]) is None  # 변형 체스
    assert parse_game(raws["abt00001"]) is None  # 중단된 대국


def test_initial_import(engine, fake):
    progress = import_player(engine, "TestUser", fake.client(), now=lambda: NOW)

    assert progress.mode == "initial"
    assert progress.since == datetime(2023, 6, 1, tzinfo=UTC)
    assert progress.games_seen == 6
    assert progress.games_added == 4  # 변형·중단 대국 제외

    (req,) = fake.game_requests()
    assert req.headers["Accept"] == "application/x-ndjson"
    assert req.url.params["sort"] == "dateAsc"
    assert req.url.params["since"] == str(int(datetime(2023, 6, 1, tzinfo=UTC).timestamp() * 1000))
    assert "chess960" not in req.url.params["perfType"]

    with Session(engine) as s:
        player = s.exec(select(Player)).one()
        assert (player.platform, player.username, player.display_name) == ("lichess", "testuser", "TestUser")
        assert player.last_imported_at is not None
        assert {g.platform for g in s.exec(select(Game))} == {"lichess"}


def test_initial_import_limited_to_recent_years(engine, fake):
    # 3년 전이 2024-01-01이면, 그 뒤에 시작된 AI 대국 하나만 받는다.
    progress = import_player(engine, "testuser", fake.client(), now=lambda: datetime(2027, 1, 1, tzinfo=UTC))
    assert progress.games_added == 1


def test_update_fetches_from_last_game(engine, fake):
    import_player(engine, "testuser", fake.client(), now=lambda: NOW)
    fake.requests.clear()

    new = {**fixture_games()[0], "id": "new00001", "createdAt": 1800000000000, "lastMoveAt": 1800000300000}
    fake.games.append(new)
    progress = import_player(engine, "testuser", fake.client(), now=lambda: NOW)

    assert progress.mode == "update"
    last_end = datetime.fromtimestamp(1706300600000 / 1000, UTC)  # 저장된 마지막 대국(AI 대국)
    assert progress.since == last_end
    # 마지막 대국 종료 7일 전부터 다시 받고, 이미 있는 대국은 거른다.
    (req,) = fake.game_requests()
    assert int(req.url.params["since"]) == int((last_end.timestamp() - 7 * 86400) * 1000)
    assert progress.games_added == 1
    with Session(engine) as s:
        assert len(s.exec(select(Game)).all()) == 5


def test_retries_on_429(engine, fake):
    fake.status_overrides["/api/games/user/testuser"] = [429]
    progress = import_player(engine, "testuser", fake.client(), now=lambda: NOW)
    assert fake.sleeps == [60.0]  # 429를 받으면 최소 1분 기다린다
    assert progress.games_added == 4


def test_unknown_player(engine, fake):
    with pytest.raises(PlayerNotFound):
        import_player(engine, "nobody", fake.client(), now=lambda: NOW)


@pytest.mark.parametrize("name", ["", "x", "a/b", "a b", "x" * 31])
def test_rejects_invalid_username(engine, fake, name):
    with pytest.raises(ImporterError):
        import_player(engine, name, fake.client(), now=lambda: NOW)
    assert fake.requests == []


def test_stats_work_for_lichess_games(engine, session, fake):
    import_player(engine, "testuser", fake.client(), now=lambda: NOW)
    start = position_key(board_from_input())
    stats = position_move_stats(session, "lichess", "testuser", start)
    # 내가 백인 대국: wsAN8bXO(1.d4), 5R5vsbuD(1.Nc3) / 상대가 백: 5tr0Ni8v(1.e4), AI 대국(1.e4)
    assert {m.san: m.games for m in stats.player.moves} == {"d4": 1, "Nc3": 1}
    assert {m.san: m.games for m in stats.opponent.moves} == {"e4": 2}
    # 체스닷컴 통계와 섞이지 않는다.
    assert position_move_stats(session, "chesscom", "testuser", start).player.total == 0
