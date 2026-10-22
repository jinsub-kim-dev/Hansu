import logging
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import Engine, event, inspect, text
from sqlalchemy.engine import make_url
from sqlmodel import Session, SQLModel, create_engine, func, select

from app.config import settings

log = logging.getLogger(__name__)


def normalize_url(url: str) -> str:
    """Supabase 등이 주는 postgres:// 주소를 psycopg(3) 드라이버 주소로 바꾼다."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def make_engine(url: str) -> Engine:
    url = normalize_url(url)
    if url.startswith("postgresql"):
        # Supabase 풀러는 연결 수가 적고 오래 쉰 연결을 끊으므로, 작은 풀에 사용 전 확인을 켠다.
        return create_engine(url, pool_size=3, max_overflow=2, pool_pre_ping=True, pool_recycle=300)
    if url.startswith("sqlite"):
        db_path = make_url(url).database
        if db_path and db_path != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

    return engine


engine = make_engine(settings.database_url)


def init_db(target: Engine | None = None) -> None:
    from app.models.db import ArchiveFetch, Player

    target = target or engine
    legacy_index = _drop_legacy_position_index(target)
    SQLModel.metadata.create_all(target)
    _add_missing_columns(target)
    if legacy_index:
        from app.importers.base import rebuild_position_index

        rebuild_position_index(target)
    # Player 테이블이 생기기 전에 가져온 플레이어를 목록에 채워 넣는다.
    with Session(target) as session:
        known = set(session.exec(select(Player.platform, Player.username)).all())
        for platform, username in session.exec(
            select(ArchiveFetch.platform, ArchiveFetch.username).distinct()
        ).all():
            if (platform, username) not in known:
                last = session.exec(
                    select(func.max(ArchiveFetch.fetched_at)).where(
                        ArchiveFetch.platform == platform, ArchiveFetch.username == username
                    )
                ).one()
                session.add(Player(platform=platform, username=username, last_imported_at=last))
        session.commit()


def _drop_legacy_position_index(target: Engine) -> bool:
    """FEN 문자열로 저장하던 옛 포지션 색인이면 지운다(대국 PGN에서 다시 만들 수 있는 파생 데이터)."""
    insp = inspect(target)
    if not insp.has_table("positionmove"):
        return False
    columns = {c["name"] for c in insp.get_columns("positionmove")}
    if "position_hash" in columns:
        return False
    log.warning("옛 포지션 색인(positionmove)을 지우고 새 형식으로 다시 만듭니다.")
    with target.begin() as conn:
        conn.execute(text("DROP TABLE positionmove"))
    return True


def _add_missing_columns(target: Engine) -> None:
    """모델에 새로 생긴 nullable 컬럼을 기존 테이블에 추가한다 (create_all은 컬럼을 추가하지 않는다)."""
    insp = inspect(target)
    with target.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in existing and col.nullable:
                    col_type = col.type.compile(target.dialect)
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col_type}'))


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
