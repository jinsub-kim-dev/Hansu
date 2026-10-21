from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import Engine, event, inspect, text
from sqlalchemy.engine import make_url
from sqlmodel import Session, SQLModel, create_engine, func, select

from app.config import settings


def make_engine(url: str) -> Engine:
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
    SQLModel.metadata.create_all(target)
    _add_missing_columns(target)
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
