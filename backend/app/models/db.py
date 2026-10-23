from datetime import UTC, date, datetime

from sqlalchemy import JSON, BigInteger, Index, UniqueConstraint
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
    """대국의 각 수를 '수를 두기 전 포지션'과 함께 저장한 색인. 포지션별 수순 통계에 쓴다.

    대국당 수십 줄이 쌓이는 가장 큰 테이블이라 작게 저장한다: 포지션은 FEN 문자열 대신
    64비트 해시(positions.position_hash), 수는 UCI만 두고 SAN은 조회할 때 포지션에서 만든다.
    """

    __table_args__ = (Index("ix_positionmove_hash_game", "position_hash", "game_id"),)

    game_id: int = Field(foreign_key="game.id", primary_key=True, ondelete="CASCADE")
    ply: int = Field(primary_key=True)  # 1 = 백의 첫 수
    position_hash: int = Field(sa_type=BigInteger)  # 수를 두기 전 포지션 키의 해시
    white_to_move: bool  # 수를 둔 쪽이 백인지
    uci: str


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
    # 연결을 끊은 시각. 줄은 지우지 않고 남겨, 같은 계정을 다시 연결하면 원래 사용자(와 복기 노트)로 돌아온다.
    unlinked_at: datetime | None = None


class ReviewPosition(SQLModel, table=True):
    """사용자가 복기하려고 보관한 포지션(복기 노트).

    그 장면까지의 맥락을 다시 열 수 있게 시작 포지션과 수순을 함께 둔다. 한 사용자는 같은 포지션을
    한 번만 보관한다(수순이 달라도 포지션 키가 같으면 같은 포지션). 엔진 평가는 볼 때 브라우저가
    계산하고, 목록에 판정 기호를 보여주려고 보관할 때의 판정만 적어 둔다.
    """

    __table_args__ = (UniqueConstraint("user_id", "position_key"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    start_fen: str
    moves: str = ""  # 시작 포지션부터 이 포지션까지의 수(UCI, 공백 구분)
    fen: str  # 이 포지션
    position_key: str
    color: str  # 내 진영: white / black
    my_move: str | None = None  # 내가 둔 수 (UCI)
    my_idea: str | None = None  # 엔진을 보기 전에 내가 생각한 더 좋은 수 (UCI)
    best_move: str | None = None  # 보관할 때의 엔진 최선 수 (UCI)
    classification: str | None = None  # 보관할 때의 내 수 판정
    tags: list[str] = Field(default_factory=list, sa_type=JSON)
    source_url: str | None = None  # 원래 대국 주소
    game_date: date | None = None  # 원래 대국 날짜
    reviewed_at: datetime | None = None  # 복기를 마쳤다고 표시한 시각
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ReviewNote(SQLModel, table=True):
    """복기 노트의 메모. 덮어쓰지 않고 날짜별로 쌓아 복기 기록이 된다."""

    id: int | None = Field(default=None, primary_key=True)
    review_id: int = Field(foreign_key="reviewposition.id", index=True, ondelete="CASCADE")
    body: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
