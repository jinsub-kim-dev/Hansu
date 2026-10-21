from datetime import UTC, datetime

from sqlalchemy import Index, UniqueConstraint
from sqlmodel import Field, SQLModel


class Game(SQLModel, table=True):
    """플랫폼과 무관한 공통 대국 모델. 사용자 이름은 소문자로 저장한다."""

    __table_args__ = (UniqueConstraint("platform", "external_id"),)

    id: int | None = Field(default=None, primary_key=True)
    platform: str = Field(index=True)
    external_id: str
    url: str | None = None
    white: str = Field(index=True)
    black: str = Field(index=True)
    white_rating: int | None = None
    black_rating: int | None = None
    time_class: str | None = None  # bullet / blitz / rapid / daily / classical
    time_control: str | None = None
    rated: bool | None = None
    result: str  # "1-0" / "0-1" / "1/2-1/2"
    end_time: datetime | None = None
    pgn: str


class PositionMove(SQLModel, table=True):
    """대국의 각 수를 '수를 두기 전 포지션'과 함께 저장한 색인. 포지션별 수순 통계에 쓴다."""

    __table_args__ = (Index("ix_positionmove_key_game", "position_key", "game_id"),)

    id: int | None = Field(default=None, primary_key=True)
    game_id: int = Field(foreign_key="game.id", index=True, ondelete="CASCADE")
    ply: int  # 1 = 백의 첫 수
    position_key: str  # 수를 두기 전 포지션의 정규화된 FEN (수 카운터 제외)
    color: str  # 수를 둔 쪽: "white" / "black"
    uci: str
    san: str


class Player(SQLModel, table=True):
    """대국을 가져온 플레이어. 새로고침해도 다시 가져오지 않고 바로 고를 수 있게 기록해 둔다."""

    __table_args__ = (UniqueConstraint("platform", "username"),)

    id: int | None = Field(default=None, primary_key=True)
    platform: str
    username: str  # 소문자
    display_name: str | None = None  # 플랫폼에 표시되는 대소문자 그대로의 이름
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    last_imported_at: datetime | None = None  # 마지막으로 가져오기를 끝낸 시각


class ArchiveFetch(SQLModel, table=True):
    """가져온 월별 아카이브 기록. final이면 다시 조회하지 않는다."""

    url: str = Field(primary_key=True)
    platform: str
    username: str = Field(index=True)
    fetched_at: datetime
    final: bool


class EngineEval(SQLModel, table=True):
    """엔진 평가 캐시. uci가 빈 문자열이면 포지션 자체(최선 수)의 평가다.

    점수는 포지션에서 둘 차례인 쪽(=수를 둔 쪽) 기준. 메이트는 cp를 ±(10000 - 수)로 환산해 함께 둔다.
    """

    __table_args__ = (UniqueConstraint("position_key", "uci", "depth"),)

    id: int | None = Field(default=None, primary_key=True)
    position_key: str = Field(index=True)
    uci: str
    depth: int
    cp: int
    mate: int | None = None
    pv: str = ""  # 이어지는 최선 수순 (uci, 공백 구분)
    # 포지션 행: 분석한 후보 수(MultiPV) 개수. 수 행: 엔진 후보 순위(1부터), 후보가 아니면 None.
    rank: int | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class User(SQLModel, table=True):
    """로그인한 사용자. 플랫폼 계정(LinkedAccount)을 여러 개 연결할 수 있다."""

    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class LinkedAccount(SQLModel, table=True):
    """OAuth로 본인 확인을 마친 플랫폼 계정. 한 플랫폼 계정은 한 사용자에게만 연결된다."""

    __table_args__ = (UniqueConstraint("platform", "username"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    platform: str
    username: str  # 소문자
    display_name: str | None = None
    linked_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
