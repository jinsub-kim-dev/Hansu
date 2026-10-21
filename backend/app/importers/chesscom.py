"""체스닷컴 Published-Data API 수집기.

월별 아카이브 목록을 받은 뒤 각 월의 대국을 순차적으로 가져온다. 끝난 달의 아카이브는
더 이상 바뀌지 않으므로 한 번 가져오면 ArchiveFetch에 final로 기록해 두고 다시 조회하지 않는다.
"""

import logging
import re
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import Engine
from sqlmodel import Session, select

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
from app.models.db import ArchiveFetch

log = logging.getLogger(__name__)

PLATFORM = "chesscom"
BASE_URL = "https://api.chess.com/pub"
USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,50}$")
ARCHIVE_MONTH_RE = re.compile(r"/games/(\d{4})/(\d{2})$")

# 아카이브가 확정됐다고 보기 전에 월말 이후 기다리는 시간 (월 경계에 끝난 대국 반영 지연 대비)
FINAL_GRACE = timedelta(days=1)


def validate_username(username: str) -> str:
    if not USERNAME_RE.fullmatch(username):
        raise ImporterError("invalid_username", platform=PLATFORM)
    return username.lower()


class ChessComClient:
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

    def _get_json(self, url: str) -> dict[str, Any]:
        # 병렬 요청은 429를 부르므로 항상 한 번에 하나씩 보낸다.
        for attempt in range(self.max_retries + 1):
            resp = self.http.get(url)
            if resp.status_code == 429 and attempt < self.max_retries:
                log.info("체스닷컴 429, %.0f초 대기 후 재시도: %s", self.retry_wait, url)
                self.sleep(self.retry_wait)
                continue
            if resp.status_code in (404, 410):
                raise PlayerNotFound("player_not_found", platform=PLATFORM)
            if resp.status_code >= 400:
                raise ImporterError("api_error", platform=PLATFORM, status=resp.status_code)
            return resp.json()
        raise ImporterError("rate_limited", platform=PLATFORM)

    def archives(self, username: str) -> list[str]:
        return self._get_json(f"{BASE_URL}/player/{username}/games/archives").get("archives", [])

    def month_games(self, archive_url: str) -> list[dict[str, Any]]:
        return self._get_json(archive_url).get("games", [])


def make_http_client(user_agent: str) -> httpx.Client:
    return httpx.Client(headers={"User-Agent": user_agent}, timeout=30.0, follow_redirects=True)


def _result(raw: dict[str, Any]) -> str:
    if raw["white"].get("result") == "win":
        return "1-0"
    if raw["black"].get("result") == "win":
        return "0-1"
    return "1/2-1/2"


def parse_game(raw: dict[str, Any]) -> NormalizedGame | None:
    """체스닷컴 대국 JSON을 공통 모델로 바꾼다. 표준 체스가 아니면 None."""
    if raw.get("rules", "chess") != "chess" or not raw.get("pgn"):
        return None
    white, black = raw["white"], raw["black"]
    end_time = raw.get("end_time")
    return NormalizedGame(
        platform=PLATFORM,
        external_id=raw.get("uuid") or raw["url"],
        url=raw.get("url"),
        white=white["username"].lower(),
        black=black["username"].lower(),
        white_rating=white.get("rating"),
        black_rating=black.get("rating"),
        time_class=raw.get("time_class"),
        time_control=raw.get("time_control"),
        rated=raw.get("rated"),
        result=_result(raw),
        end_time=datetime.fromtimestamp(end_time, UTC) if end_time else None,
        pgn=raw["pgn"],
    )


def _display_name(raws: list[dict[str, Any]], username: str) -> str | None:
    """아카이브 대국에서 플레이어의 대소문자 그대로의 이름을 찾는다(나중 대국 우선)."""
    for raw in reversed(raws):
        for side in ("white", "black"):
            name = raw.get(side, {}).get("username", "")
            if name.lower() == username:
                return name
    return None


def archive_month(archive_url: str) -> tuple[int, int] | None:
    m = ARCHIVE_MONTH_RE.search(archive_url)
    return (int(m.group(1)), int(m.group(2))) if m else None


def is_final_archive(archive_url: str, now: datetime) -> bool:
    m = ARCHIVE_MONTH_RE.search(archive_url)
    if not m:
        return False
    year, month = int(m.group(1)), int(m.group(2))
    next_month = datetime(year + month // 12, month % 12 + 1, 1, tzinfo=UTC)
    return now >= next_month + FINAL_GRACE


def import_player(
    engine: Engine,
    username: str,
    client: ChessComClient,
    on_progress: ProgressCallback | None = None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
    history_years: int = 3,
) -> ImportProgress:
    """플레이어의 대국을 가져온다.

    저장된 대국이 없으면 최근 history_years년 동안 끝난 대국만 가져오고(initial),
    있으면 마지막 대국이 끝난 달부터 다시 확인해 그 뒤에 끝난 대국만 추가한다(update).
    """
    username = validate_username(username)
    progress = ImportProgress()

    def report() -> None:
        if on_progress:
            on_progress(progress)

    archive_urls = client.archives(username)
    with Session(engine) as session:
        # 아카이브 목록을 받았다면 존재하는 플레이어다. 중간에 끊겨도 목록에는 남긴다.
        upsert_player(session, PLATFORM, username)
        session.commit()
        last = last_game_end(session, PLATFORM, username)
        cached_final = set(
            session.exec(
                select(ArchiveFetch.url).where(
                    ArchiveFetch.platform == PLATFORM,
                    ArchiveFetch.username == username,
                    ArchiveFetch.final == True,  # noqa: E712
                )
            ).all()
        )
    if last is None:
        progress.mode, progress.since = "initial", years_before(now(), history_years)
    else:
        progress.mode, progress.since = "update", last
    since = progress.since
    # since가 속한 달과 그 뒤의 아카이브만 본다. 그보다 앞선 달은 요청하지 않는다.
    first_month = (since.year, since.month)
    archive_urls = [u for u in archive_urls if (archive_month(u) or first_month) >= first_month]
    progress.archives_total = len(archive_urls)
    report()

    def wanted(g: NormalizedGame) -> bool:
        # 업데이트 때 기준 시각과 같은 시각에 끝난 대국도 받는다. 이미 저장된 대국은 store_games가 거른다.
        return g.end_time is None or g.end_time >= since

    for url in archive_urls:
        if url in cached_final:
            progress.archives_skipped += 1
        else:
            raws = client.month_games(url)
            games = [g for raw in raws if (g := parse_game(raw)) and wanted(g)]
            fetched_at = now()
            with Session(engine) as session:
                progress.games_added += store_games(session, games)
                if name := _display_name(raws, username):
                    upsert_player(session, PLATFORM, username, display_name=name)
                session.merge(
                    ArchiveFetch(
                        url=url,
                        platform=PLATFORM,
                        username=username,
                        fetched_at=fetched_at,
                        final=is_final_archive(url, fetched_at),
                    )
                )
                session.commit()
        progress.archives_done += 1
        report()

    with Session(engine) as session:
        upsert_player(session, PLATFORM, username, imported_at=now())
        session.commit()
    return progress
