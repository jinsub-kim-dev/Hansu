from datetime import UTC, datetime

from sqlmodel import Session, delete, select

from app.analysis.stats import list_players, player_summary
from app.db import init_db, make_engine
from app.importers.chesscom import import_player
from app.models.db import Player

NOW = datetime(2026, 10, 19, tzinfo=UTC)


def test_import_records_player(engine, session, fake_chesscom):
    import_player(engine, "testuser", fake_chesscom.client(), now=lambda: NOW)

    player = session.exec(select(Player)).one()
    assert player.username == "testuser"
    assert player.display_name == "TestUser"  # 아카이브의 대소문자 그대로
    assert player.last_imported_at is not None

    assert list_players(session) == [
        {
            "platform": "chesscom",
            "username": "testuser",
            "display_name": "TestUser",
            "last_imported_at": player.last_imported_at,
            "total_games": 6,
            "last_game_at": datetime(2026, 10, 21, tzinfo=UTC),
        }
    ]


def test_data_survives_restart(tmp_path, fake_chesscom):
    url = f"sqlite:///{(tmp_path / 'sub' / 'chess.db').as_posix()}"  # 없는 폴더도 만든다
    first = make_engine(url)
    init_db(first)
    import_player(first, "testuser", fake_chesscom.client(), now=lambda: NOW)
    first.dispose()

    # 서버를 다시 띄운 것처럼 새 엔진으로 연다.
    second = make_engine(url)
    init_db(second)
    with Session(second) as s:
        summary = player_summary(s, "chesscom", "testuser")
        assert summary["saved"] and summary["total_games"] == 6
        assert summary["display_name"] == "TestUser"

    # 끝난 달 아카이브 캐시도 남아 있어 다시 요청하지 않는다.
    fake_chesscom.requests.clear()
    import_player(second, "testuser", fake_chesscom.client(), now=lambda: NOW)
    assert "/pub/player/testuser/games/2026/08" not in fake_chesscom.requests
    second.dispose()


def test_init_db_adds_new_columns_to_old_tables(tmp_path):
    import sqlite3

    path = tmp_path / "old.db"
    # rank 컬럼이 없던 시절의 engineeval 테이블
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE engineeval (id INTEGER PRIMARY KEY, position_key VARCHAR NOT NULL, "
        "uci VARCHAR NOT NULL, depth INTEGER NOT NULL, cp INTEGER NOT NULL, mate INTEGER, "
        "pv VARCHAR NOT NULL, created_at DATETIME NOT NULL)"
    )
    con.close()

    eng = make_engine(f"sqlite:///{path.as_posix()}")
    init_db(eng)
    eng.dispose()

    con = sqlite3.connect(path)
    cols = {row[1] for row in con.execute("PRAGMA table_info(engineeval)")}
    con.close()
    assert "rank" in cols


def test_init_db_backfills_players_from_archives(engine, fake_chesscom):
    # Player 테이블이 생기기 전에 가져온 데이터를 흉내 낸다.
    import_player(engine, "testuser", fake_chesscom.client(), now=lambda: NOW)
    with Session(engine) as s:
        s.exec(delete(Player))
        s.commit()

    init_db(engine)

    with Session(engine) as s:
        player = s.exec(select(Player)).one()
        assert player.username == "testuser"
        assert player.last_imported_at is not None


def test_legacy_position_index_is_rebuilt(engine, fake_chesscom):
    """FEN 문자열로 저장하던 옛 색인은 지우고 대국 PGN으로 새 형식 색인을 다시 만든다."""
    from sqlalchemy import text

    from app.analysis.positions import board_from_input, position_key
    from app.analysis.stats import position_move_stats

    import_player(engine, "testuser", fake_chesscom.client(), now=lambda: NOW)
    start = position_key(board_from_input())
    with Session(engine) as s:
        before = position_move_stats(s, "chesscom", "testuser", start)

    # 옛 형식 테이블로 바꿔 놓는다.
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE positionmove"))
        conn.execute(text(
            "CREATE TABLE positionmove (id INTEGER PRIMARY KEY, game_id INTEGER, ply INTEGER, "
            "position_key VARCHAR, color VARCHAR, uci VARCHAR, san VARCHAR)"
        ))

    init_db(engine)

    with Session(engine) as s:
        after = position_move_stats(s, "chesscom", "testuser", start)
    assert after == before
    assert after.player.total == 3
