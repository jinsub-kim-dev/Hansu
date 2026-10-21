from datetime import UTC, datetime, timedelta, timezone

import chess
import pytest

from app.analysis.positions import PositionError, board_from_input, position_key
from app.analysis.stats import player_summary, position_move_stats
from app.importers.chesscom import import_player

NOW = datetime(2026, 10, 19, tzinfo=UTC)


@pytest.fixture
def imported(engine, session, fake_chesscom):
    import_player(engine, "testuser", fake_chesscom.client(), now=lambda: NOW)
    return session


def key_after(moves: str) -> str:
    return position_key(board_from_input(pgn=moves))


def by_san(group):
    return {m.san: m for m in group.moves}


def test_start_position(imported):
    stats = position_move_stats(imported, "chesscom", "TestUser", key_after(""))

    # 플레이어가 백인 대국: 1,2,6 → e4 2번, d4 1번
    player = by_san(stats.player)
    assert stats.player.total == 3
    assert (player["e4"].games, player["e4"].wins, player["e4"].losses) == (2, 1, 1)
    assert player["d4"].games == 1
    assert stats.player.moves[0].san == "e4"  # 많이 둔 순

    # 상대가 백인 대국: 3,4,7 → e4, d4, c4. 승패는 플레이어 기준
    opp = by_san(stats.opponent)
    assert stats.opponent.total == 3
    assert opp["e4"].draws == 1
    assert opp["d4"].losses == 1
    assert opp["c4"].wins == 1


def test_after_e4_shows_opponent_replies_and_player_replies(imported):
    stats = position_move_stats(imported, "chesscom", "testuser", key_after("1. e4"))
    # 1.e4 뒤는 흑 차례: 플레이어가 흑인 3번 대국에서 e5, 상대(흑)는 1,2번에서 e5, c5
    assert {m.san: m.games for m in stats.player.moves} == {"e5": 1}
    assert {m.san: m.games for m in stats.opponent.moves} == {"e5": 1, "c5": 1}


def test_transposition_is_merged(imported):
    # 1.d4 d5 2.c4 e6 (4번)과 1.c4 e6 2.d4 d5 (7번)은 같은 포지션
    a = position_move_stats(imported, "chesscom", "testuser", key_after("1. d4 d5 2. c4 e6"))
    b = position_move_stats(imported, "chesscom", "testuser", key_after("1. c4 e6 2. d4 d5"))
    assert a == b
    # 백 차례이고 플레이어는 두 대국 모두 흑 → 상대들의 수만 있다
    assert a.player.total == 0
    assert {m.san for m in a.opponent.moves} == {"Nc3"}  # 4번은 여기서 끝


def test_filters(imported):
    start = key_after("")
    rapid = position_move_stats(imported, "chesscom", "testuser", start, time_classes=["rapid"])
    assert rapid.player.total == 0
    assert {m.san for m in rapid.opponent.moves} == {"d4", "c4"}

    both = position_move_stats(
        imported, "chesscom", "testuser", start, time_classes=["rapid", "blitz"]
    )
    assert both == position_move_stats(imported, "chesscom", "testuser", start)
    bullet = position_move_stats(imported, "chesscom", "testuser", start, time_classes=["bullet"])
    assert bullet.player.total == bullet.opponent.total == 0

    as_black = position_move_stats(imported, "chesscom", "testuser", start, player_color="black")
    assert as_black.player.total == 0
    assert as_black.opponent.total == 3


def test_unknown_position_is_empty(imported):
    stats = position_move_stats(imported, "chesscom", "testuser", key_after("1. h4 h5"))
    assert stats.player.total == stats.opponent.total == 0


def test_player_summary(imported):
    s = player_summary(imported, "chesscom", "TESTUSER")
    assert s["total_games"] == 6
    assert s["by_time_class"] == {"blitz": 4, "rapid": 2}


def test_board_from_input():
    fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
    assert position_key(board_from_input(fen=fen)) == key_after("1. e4")
    assert board_from_input(pgn='[Event "x"]\n\n1. e4 e5 *').fen() == (
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
    )
    assert board_from_input() == chess.Board()
    with pytest.raises(PositionError):
        board_from_input(fen="not a fen")
    with pytest.raises(PositionError):
        board_from_input(pgn="1. e4 e4")


def test_period_filter(imported):
    start = key_after("")
    sept = datetime(2026, 9, 1, tzinfo=UTC)

    after = position_move_stats(imported, "chesscom", "testuser", start, since=sept)
    # 10월에 끝난 대국만: 6번(내가 백, d4), 7번(상대가 백, c4)
    assert {m.san: m.games for m in after.player.moves} == {"d4": 1}
    assert {m.san: m.games for m in after.opponent.moves} == {"c4": 1}

    before = position_move_stats(imported, "chesscom", "testuser", start, until=sept)
    assert {m.san: m.games for m in before.player.moves} == {"e4": 2}
    assert {m.san: m.games for m in before.opponent.moves} == {"e4": 1, "d4": 1}

    # 시간대가 다른 시각도 UTC로 맞춰 비교한다 (2026-10-21 09:00 KST = 10-21 00:00 UTC).
    kst = timezone(timedelta(hours=9))
    only_oct21 = position_move_stats(
        imported, "chesscom", "testuser", start,
        since=datetime(2026, 10, 21, 9, tzinfo=kst), until=datetime(2026, 10, 22, 9, tzinfo=kst),
    )
    assert only_oct21.player.total + only_oct21.opponent.total == 2
