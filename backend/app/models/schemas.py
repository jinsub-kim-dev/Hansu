from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

Platform = Literal["chesscom", "lichess"]
Side = Literal["white", "black"]


class ImportProgressOut(BaseModel):
    archives_total: int
    archives_done: int
    archives_skipped: int
    games_added: int
    games_seen: int
    mode: Literal["initial", "update"]
    since: datetime | None


class ImportJobOut(BaseModel):
    id: str
    platform: str
    username: str
    status: Literal["queued", "running", "done", "error"]
    progress: ImportProgressOut
    error: str | None
    created_at: datetime
    finished_at: datetime | None


class SavedPlayerOut(BaseModel):
    platform: str
    username: str
    display_name: str | None
    last_imported_at: datetime | None
    total_games: int
    last_game_at: datetime | None  # 저장된 마지막 대국이 끝난 시각. 업데이트는 이 이후만 받는다.


class ImportSettingsOut(BaseModel):
    history_years: int  # 처음 가져올 때 받는 기간(년)


class PlayerSummaryOut(BaseModel):
    platform: str
    username: str
    display_name: str | None
    saved: bool  # 가져오기를 한 적 있는 플레이어인지
    last_imported_at: datetime | None
    total_games: int
    by_time_class: dict[str, int]
    first_game_at: datetime | None
    last_game_at: datetime | None


class MoveStatOut(BaseModel):
    uci: str
    san: str
    games: int
    wins: int
    draws: int
    losses: int


class MoveStatGroupOut(BaseModel):
    total: int
    moves: list[MoveStatOut]


class PositionMoveStatsOut(BaseModel):
    fen: str
    position_key: str
    side_to_move: Side
    player: MoveStatGroupOut
    opponent: MoveStatGroupOut


class CandidateLineOut(BaseModel):
    uci: str
    san: str
    cp: int  # 백 기준
    mate: int | None
    pv_san: list[str]


class EngineLineOut(BaseModel):
    best_uci: str | None
    best_san: str | None
    cp: int  # 백 기준 centipawn (메이트는 ±(10000 - 수))
    mate: int | None  # 백 기준. 양수면 백이 메이트
    pv_san: list[str]
    lines: list[CandidateLineOut]  # 엔진 후보 수 (좋은 순)


class MoveEvalOut(BaseModel):
    uci: str
    san: str
    cp: int  # 이 수를 둔 뒤 백 기준 평가
    mate: int | None
    cp_loss: int | None  # 최선 수 대비 손실 (수를 둔 쪽 기준, 0 이상)
    win_chance_loss: float | None  # 기대 승률 손실 0~1
    classification: Literal["best", "good", "inaccuracy", "mistake", "blunder"] | None


class PositionEvalOut(BaseModel):
    status: Literal["done", "pending", "failed", "unavailable"]
    message: str | None = None
    depth: int | None = None
    position: EngineLineOut | None = None
    moves: list[MoveEvalOut] = []


class OpeningOut(BaseModel):
    eco: str
    name: str


class OpeningContinuationOut(BaseModel):
    uci: str
    san: str
    eco: str
    name: str


class OpeningClassificationOut(BaseModel):
    opening: OpeningOut | None  # 마지막으로 지나간 이론 포지션의 오프닝
    in_book: bool  # 현재 포지션이 이론 포지션인지
    plies_out_of_book: int  # 이론을 벗어난 뒤 둔 수
    continuations: list[OpeningContinuationOut]  # 이론으로 이어지는 다음 수


class AuthProviderOut(BaseModel):
    platform: Platform
    label: str
    enabled: bool  # False면 아직 계정 연결을 쓸 수 없다(예: 체스닷컴 OAuth 승인 대기)


class LinkedAccountOut(BaseModel):
    platform: Platform
    username: str
    display_name: str | None
    linked_at: datetime


class MeOut(BaseModel):
    user_id: int | None  # 로그인 전이면 None
    accounts: list[LinkedAccountOut]


Classification = Literal["best", "good", "inaccuracy", "mistake", "blunder"]


class ReviewNoteOut(BaseModel):
    id: int
    body: str
    created_at: datetime


class ReviewOut(BaseModel):
    id: int
    start_fen: str
    moves: list[str]  # 시작 포지션부터 이 포지션까지 (UCI)
    fen: str
    color: Side
    my_move: str | None
    my_idea: str | None
    best_move: str | None
    classification: Classification | None
    tags: list[str]
    source_url: str | None
    game_date: date | None
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    notes: list[ReviewNoteOut]  # 오래된 순


class ReviewIn(BaseModel):
    start_fen: str
    moves: list[str] = []
    color: Side
    my_move: str | None = None
    my_idea: str | None = None
    best_move: str | None = None
    classification: Classification | None = None
    tags: list[str] = []
    source_url: str | None = None
    game_date: date | None = None
    note: str | None = None  # 첫 메모


class ReviewPatch(BaseModel):
    """보낸 필드만 바꾼다(null을 보내면 비운다)."""

    color: Side | None = None
    my_move: str | None = None
    my_idea: str | None = None
    best_move: str | None = None
    classification: Classification | None = None
    tags: list[str] | None = None
    source_url: str | None = None
    game_date: date | None = None
    reviewed: bool | None = None


class ReviewNoteIn(BaseModel):
    body: str


class GameSummaryOut(BaseModel):
    """대국 목록의 한 줄. 결과·레이팅은 내 기준."""

    id: int
    platform: Platform
    url: str | None
    color: Side  # 내가 잡은 색
    outcome: Literal["win", "draw", "loss"]
    result: str
    me: str
    my_rating: int | None
    opponent: str
    opponent_rating: int | None
    time_class: str | None
    time_control: str | None
    rated: bool | None
    end_time: datetime | None
    plies: int
    opening: OpeningOut | None


class GameListOut(BaseModel):
    total: int
    games: list[GameSummaryOut]


class GameDetailOut(GameSummaryOut):
    start_fen: str
    moves: list[str]  # UCI
    pgn: str
