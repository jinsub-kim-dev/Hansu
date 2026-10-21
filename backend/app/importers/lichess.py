"""Lichess 수집기.

`GET /api/games/user/{username}`(NDJSON 스트리밍)으로 대국을 받는다. 한 번에 한 요청만 보내고,
429를 받으면 최소 1분 기다린 뒤 다시 시도한다.

Lichess의 `since`는 대국이 *시작된* 시각 기준이다. 우리 DB는 끝난 시각을 저장하므로, 업데이트 때는
마지막 대국이 끝난 시각보다 UPDATE_OVERLAP만큼 앞에서부터 받고 이미 저장된 대국은 store_games가 거른다.
(그보다 오래 이어진 통신 체스 대국은 놓칠 수 있다.)
대국은 오래된 순(dateAsc)으로 받아, 중간에 끊겨도 다음 업데이트가 이어서 받게 한다.
"""

import json
import logging
import re
import time
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import Engine
from sqlmodel import Session

from app.importers.base import (
    ImporterError,
    ImportProgress,
    NormalizedGame,
    PlayerNotFound,
    ProgressCallback,
    last_game_end,
    store_games,
    upsert_player,
    years_before,
)

log = logging.getLogger(__name__)

PLATFORM = "lichess"
BASE_URL = "https://lichess.org"
USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]{2,30}$")
# 표준 체스만 받는다 (변형 체스 제외).
PERF_TYPES = "ultraBullet,bullet,blitz,rapid,classical,correspondence"
UPDATE_OVERLAP = timedelta(days=7)
BATCH_SIZE = 200
# 결과가 나지 않은 대국 상태
UNFINISHED = {"created", "started", "aborted", "noStart", "unknownFinish"}
# Lichess 속도 → 공통 time_class (체스닷컴과 이름을 맞춘다)
TIME_CLASS = {
    "ultraBullet": "bullet",
    "bullet": "bullet",
    "blitz": "blitz",
    "rapid": "rapid",
    "classical": "classical",
    "correspondence": "daily",
}


def validate_username(username: str) -> str:
    if not USERNAME_RE.fullmatch(username):
        raise ImporterError("리체스 아이디 형식이 올바르지 않습니다.")
    return username.lower()


class LichessClient:
    def __init__(
        self,
        http: httpx.Client,
        retry_wait: float = 60.0,
        max_retries: int = 3,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.http = http
        self.retry_wait = retry_wait
        self.max_retries = max_retries
        self.sleep = sleep

    def _check(self, resp: httpx.Response) -> None:
        if resp.status_code == 404:
            raise PlayerNotFound("리체스에서 해당 플레이어를 찾을 수 없습니다.")
        if resp.status_code >= 400:
            raise ImporterError(f"리체스 API 오류 ({resp.status_code})")

    def user(self, username: str) -> dict[str, Any]:
        for attempt in range(self.max_retries + 1):
            resp = self.http.get(f"{BASE_URL}/api/user/{username}")
            if resp.status_code == 429 and attempt < self.max_retries:
                self.sleep(self.retry_wait)
                continue
            if resp.status_code == 429:
                break
            self._check(resp)
            return resp.json()
        raise ImporterError("리체스 요청 한도를 초과했습니다. 잠시 뒤 다시 시도하세요.")

    def games(self, username: str, since: datetime) -> Iterator[dict[str, Any]]:
        """since 이후에 시작된 끝난 대국을 오래된 순으로 스트리밍한다."""
        params = {
            "since": int(since.timestamp() * 1000),
            "sort": "dateAsc",
            "perfType": PERF_TYPES,
            "pgnInJson": "true",
            "clocks": "false",
            "evals": "false",
            "opening": "false",
        }
        for attempt in range(self.max_retries + 1):
            with self.http.stream(
                "GET",
                f"{BASE_URL}/api/games/user/{username}",
                params=params,
                headers={"Accept": "application/x-ndjson"},
            ) as resp:
                if resp.status_code == 429 and attempt < self.max_retries:
                    log.info("리체스 429, %.0f초 대기 후 재시도", self.retry_wait)
                    self.sleep(self.retry_wait)
                    continue
                if resp.status_code == 429:
                    break
                self._check(resp)
                for line in resp.iter_lines():
                    if line.strip():
                        yield json.loads(line)
                return
        raise ImporterError("리체스 요청 한도를 초과했습니다. 잠시 뒤 다시 시도하세요.")


def make_http_client(user_agent: str) -> httpx.Client:
    # 스트리밍은 오래 걸릴 수 있으므로 읽기 시간 제한은 넉넉히 둔다.
    return httpx.Client(
        headers={"User-Agent": user_agent},
        timeout=httpx.Timeout(30.0, read=120.0),
        follow_redirects=True,
    )


def _player_name(side: dict[str, Any]) -> str:
    user = side.get("user")
    if user:
        return user["name"]
    if "aiLevel" in side:
        return f"lichess-ai-{side['aiLevel']}"
    return "anonymous"


def _ms(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value / 1000, UTC) if value else None


def parse_game(raw: dict[str, Any]) -> NormalizedGame | None:
    """리체스 대국 JSON을 공통 모델로 바꾼다. 표준 체스가 아니거나 끝나지 않은 대국이면 None."""
    if raw.get("variant") != "standard" or raw.get("status") in UNFINISHED or not raw.get("pgn"):
        return None
    white, black = raw["players"]["white"], raw["players"]["black"]
    winner = raw.get("winner")
    result = "1-0" if winner == "white" else "0-1" if winner == "black" else "1/2-1/2"
    clock = raw.get("clock")
    if clock:
        time_control = f"{clock['initial']}+{clock['increment']}"
    elif raw.get("daysPerTurn"):
        time_control = f"1/{raw['daysPerTurn'] * 86400}"
    else:
        time_control = None
    return NormalizedGame(
        platform=PLATFORM,
        external_id=raw["id"],
        url=f"{BASE_URL}/{raw['id']}",
        white=_player_name(white).lower(),
        black=_player_name(black).lower(),
        white_rating=white.get("rating"),
        black_rating=black.get("rating"),
        time_class=TIME_CLASS.get(raw.get("speed", ""), raw.get("speed")),
        time_control=time_control,
        rated=raw.get("rated"),
        result=result,
        end_time=_ms(raw.get("lastMoveAt")) or _ms(raw.get("createdAt")),
        pgn=raw["pgn"],
    )


def import_player(
    engine: Engine,
    username: str,
    client: LichessClient,
    on_progress: ProgressCallback | None = None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
    history_years: int = 3,
) -> ImportProgress:
    """플레이어의 대국을 가져온다.

    저장된 대국이 없으면 최근 history_years년 동안의 대국(initial), 있으면 마지막 대국 이후(update).
    """
    username = validate_username(username)
    progress = ImportProgress()

    def report() -> None:
        if on_progress:
            on_progress(progress)

    profile = client.user(username)  # 없는 아이디면 PlayerNotFound
    with Session(engine) as session:
        upsert_player(session, PLATFORM, username, display_name=profile.get("username"))
        session.commit()
        last = last_game_end(session, PLATFORM, username)

    if last is None:
        progress.mode, progress.since = "initial", years_before(now(), history_years)
        fetch_from = progress.since
    else:
        progress.mode, progress.since = "update", last
        fetch_from = last - UPDATE_OVERLAP
    since = progress.since
    report()

    def flush(batch: list[NormalizedGame]) -> None:
        with Session(engine) as session:
            progress.games_added += store_games(session, batch)
            session.commit()
        batch.clear()
        report()

    batch: list[NormalizedGame] = []
    for raw in client.games(username, fetch_from):
        progress.games_seen += 1
        game = parse_game(raw)
        if game and (game.end_time is None or game.end_time >= since):
            batch.append(game)
        if len(batch) >= BATCH_SIZE:
            flush(batch)
        elif progress.games_seen % 50 == 0:
            report()
    flush(batch)

    with Session(engine) as session:
        upsert_player(session, PLATFORM, username, imported_at=now())
        session.commit()
    return progress
