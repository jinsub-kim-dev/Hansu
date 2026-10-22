from datetime import UTC, datetime

import pytest
from sqlmodel import Session, func, select

from app.importers.base import ImporterError, PlayerNotFound
from app.analysis.positions import position_hash
from app.importers.chesscom import import_player, is_final_archive, parse_game
from app.models.db import ArchiveFetch, Game, PositionMove
from tests.conftest import load_fixture

NOW = datetime(2026, 10, 19, tzinfo=UTC)


def test_parse_game_normalizes_fields():
    raw = load_fixture("chesscom_2026_08.json")["games"][1]
    g = parse_game(raw)
    assert g.platform == "chesscom"
    assert g.external_id == "uuid-2"
    assert (g.white, g.black) == ("testuser", "opp2")
    assert g.result == "0-1"
    assert g.time_class == "blitz"
    assert g.end_time.tzinfo is not None


def test_parse_game_skips_variants():
    raw = load_fixture("chesscom_2026_08.json")["games"][4]
    assert raw["rules"] == "chess960"
    assert parse_game(raw) is None


def test_is_final_archive():
    assert is_final_archive("https://x/games/2026/08", NOW)
    assert not is_final_archive("https://x/games/2026/10", NOW)
    # 월이 바뀐 직후에는 아직 확정하지 않는다.
    assert not is_final_archive("https://x/games/2026/09", datetime(2026, 10, 1, 3, tzinfo=UTC))
    assert is_final_archive("https://x/games/2025/12", datetime(2026, 1, 2, 1, tzinfo=UTC))


def test_import_stores_games_and_positions(engine, fake_chesscom):
    progress = import_player(engine, "TestUser", fake_chesscom.client(), now=lambda: NOW)

    assert progress.archives_total == 2
    assert progress.archives_done == 2
    assert progress.games_added == 6  # chess960 제외
    with Session(engine) as s:
        assert s.exec(select(func.count()).select_from(Game)).one() == 6
        # 1번 대국은 6수
        g1 = s.exec(select(Game).where(Game.external_id == "uuid-1")).one()
        moves = s.exec(
            select(PositionMove).where(PositionMove.game_id == g1.id).order_by(PositionMove.ply)
        ).all()
        assert [m.uci for m in moves] == ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"]
        start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
        assert moves[0].position_hash == position_hash(start)
        assert (moves[0].white_to_move, moves[1].white_to_move) == (True, False)


def test_update_fetches_only_since_last_game(engine, fake_chesscom):
    import_player(engine, "testuser", fake_chesscom.client(), now=lambda: NOW)
    fake_chesscom.requests.clear()

    progress = import_player(engine, "testuser", fake_chesscom.client(), now=lambda: NOW)

    # 마지막 대국(10월)이 있는 달부터만 다시 요청한다. 8월은 요청하지 않는다.
    assert fake_chesscom.requests == [
        "/pub/player/testuser/games/archives",
        "/pub/player/testuser/games/2026/10",
    ]
    assert progress.mode == "update"
    assert progress.since == datetime(2026, 10, 21, tzinfo=UTC)  # 저장된 마지막 대국
    assert progress.archives_total == 1
    assert progress.games_added == 0
    with Session(engine) as s:
        assert s.exec(select(func.count()).select_from(Game)).one() == 6
        finals = {a.url.rsplit("/", 2)[-2:][1]: a.final for a in s.exec(select(ArchiveFetch))}
        assert finals == {"08": True, "10": False}


def test_update_adds_only_games_after_last_game(engine, fake_chesscom):
    import_player(engine, "testuser", fake_chesscom.client(), now=lambda: NOW)
    oct_games = load_fixture("chesscom_2026_10.json")["games"]
    newer = {**oct_games[0], "uuid": "uuid-new", "url": "https://www.chess.com/game/live/100",
             "end_time": oct_games[0]["end_time"] + 3600}
    older = {**oct_games[0], "uuid": "uuid-old", "url": "https://www.chess.com/game/live/101",
             "end_time": oct_games[0]["end_time"] - 3600}
    fake_chesscom.extra_games["/pub/player/testuser/games/2026/10"] = [newer, older]

    progress = import_player(engine, "testuser", fake_chesscom.client(), now=lambda: NOW)

    # 마지막 대국보다 늦게 끝난 대국만 추가한다.
    assert progress.games_added == 1
    with Session(engine) as s:
        ids = set(s.exec(select(Game.external_id)).all())
    assert "uuid-new" in ids and "uuid-old" not in ids


def test_initial_import_limited_to_recent_years(engine, fake_chesscom):
    # 3년 뒤라고 치면 2026-09-15 이후 대국만 대상: 8월 아카이브는 요청하지 않는다.
    later = datetime(2029, 9, 15, tzinfo=UTC)
    progress = import_player(engine, "testuser", fake_chesscom.client(), now=lambda: later)

    assert progress.mode == "initial"
    assert progress.since == datetime(2026, 9, 15, tzinfo=UTC)
    assert "/pub/player/testuser/games/2026/08" not in fake_chesscom.requests
    assert progress.games_added == 2  # 10월 대국만


def test_initial_import_filters_games_before_cutoff_in_boundary_month(engine, fake_chesscom):
    # 기간 시작(2026-08-15)이 8월 중간이면 8월 아카이브는 받되, 8월 1일에 끝난 대국은 뺀다.
    later = datetime(2029, 8, 15, tzinfo=UTC)
    progress = import_player(engine, "testuser", fake_chesscom.client(), now=lambda: later)

    assert "/pub/player/testuser/games/2026/08" in fake_chesscom.requests
    assert progress.games_added == 2


def test_history_years_is_configurable(engine, fake_chesscom):
    later = datetime(2029, 9, 15, tzinfo=UTC)
    progress = import_player(engine, "testuser", fake_chesscom.client(), now=lambda: later, history_years=5)
    assert progress.since == datetime(2024, 9, 15, tzinfo=UTC)
    assert progress.games_added == 6


def test_retries_on_429(engine, fake_chesscom):
    fake_chesscom.status_overrides["/pub/player/testuser/games/2026/08"] = [429]
    progress = import_player(engine, "testuser", fake_chesscom.client(), now=lambda: NOW)
    assert progress.games_added == 6
    assert fake_chesscom.requests.count("/pub/player/testuser/games/2026/08") == 2


def test_unknown_player(engine, fake_chesscom):
    with pytest.raises(PlayerNotFound):
        import_player(engine, "nobody", fake_chesscom.client(), now=lambda: NOW)


@pytest.mark.parametrize("name", ["", "a/b", "../x", "a b", "x" * 51])
def test_rejects_invalid_username(engine, fake_chesscom, name):
    with pytest.raises(ImporterError):
        import_player(engine, name, fake_chesscom.client(), now=lambda: NOW)
    assert fake_chesscom.requests == []
