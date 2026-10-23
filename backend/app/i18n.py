"""사용자에게 보여주는 메시지의 다국어(한국어/영어) 처리.

오류는 문장이 아니라 코드와 값(AppError)으로 다루고, 응답할 때 요청 언어(Accept-Language)로 문장을 만든다.
백그라운드 작업 오류처럼 나중에 조회되는 메시지도 조회하는 요청의 언어로 만든다.
"""

from typing import Any, Literal

from fastapi import Request

Lang = Literal["ko", "en"]
DEFAULT_LANG: Lang = "ko"

PLATFORM_NAMES: dict[str, dict[str, str]] = {
    "chesscom": {"ko": "체스닷컴", "en": "Chess.com"},
    "lichess": {"ko": "리체스", "en": "Lichess"},
}

MESSAGES: dict[str, dict[str, str]] = {
    # 포지션 입력
    "invalid_fen": {"ko": "잘못된 FEN입니다: {detail}", "en": "Invalid FEN: {detail}"},
    "impossible_position": {"ko": "불가능한 포지션입니다.", "en": "This position is impossible."},
    "invalid_pgn": {"ko": "PGN을 해석할 수 없습니다.", "en": "Could not read the PGN."},
    "too_many_moves": {"ko": "수는 최대 {max}개까지 보낼 수 있습니다.", "en": "At most {max} moves can be sent."},
    "illegal_move": {"ko": "둘 수 없는 수입니다: {uci}", "en": "Illegal move: {uci}"},
    "period_invalid": {"ko": "기간의 시작이 끝보다 늦습니다.", "en": "The start of the period is after its end."},
    # 엔진
    "engine_unavailable": {
        "ko": "Stockfish를 찾을 수 없습니다. STOCKFISH_PATH 환경 변수를 설정하세요.",
        "en": "Stockfish was not found. Set the STOCKFISH_PATH environment variable.",
    },
    "game_over_position": {"ko": "대국이 끝난 포지션입니다.", "en": "The game is over in this position."},
    "engine_failed": {"ko": "엔진 분석에 실패했습니다: {detail}", "en": "Engine analysis failed: {detail}"},
    # 대국 가져오기
    "invalid_username": {
        "ko": "{platform} 아이디 형식이 올바르지 않습니다.",
        "en": "That is not a valid {platform} username.",
    },
    "player_not_found": {
        "ko": "{platform}에서 해당 플레이어를 찾을 수 없습니다.",
        "en": "Player not found on {platform}.",
    },
    "api_error": {"ko": "{platform} API 오류 ({status})", "en": "{platform} API error ({status})"},
    "rate_limited": {
        "ko": "{platform} 요청 한도를 초과했습니다. 잠시 뒤 다시 시도하세요.",
        "en": "Too many requests to {platform}. Please try again later.",
    },
    "import_failed": {
        "ko": "대국을 가져오는 중 오류가 발생했습니다.",
        "en": "Something went wrong while importing games.",
    },
    "too_many_imports": {
        "ko": "가져오기 요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.",
        "en": "Too many import requests. Please try again later.",
    },
    "job_not_found": {"ko": "작업을 찾을 수 없습니다.", "en": "Import job not found."},
    "player_not_imported": {"ko": "아직 가져오지 않은 플레이어입니다.", "en": "This player has not been imported yet."},
    "game_not_found": {"ko": "대국을 찾을 수 없습니다.", "en": "Game not found."},
    # 복기 노트
    "review_not_found": {"ko": "복기 노트를 찾을 수 없습니다.", "en": "Review note not found."},
    "review_limit": {
        "ko": "복기 노트는 최대 {max}개까지 보관할 수 있습니다.",
        "en": "You can keep at most {max} review notes.",
    },
    "too_many_tags": {"ko": "태그는 최대 {max}개까지 붙일 수 있습니다.", "en": "At most {max} tags are allowed."},
    "tag_too_long": {"ko": "태그는 {max}자 이하로 적어 주세요.", "en": "Tags must be at most {max} characters."},
    "invalid_url": {
        "ko": "대국 주소는 http:// 또는 https://로 시작해야 합니다.",
        "en": "The game link must start with http:// or https://.",
    },
    "note_empty": {"ko": "메모 내용을 입력하세요.", "en": "Please write a note."},
    "note_too_long": {"ko": "메모는 {max}자 이하로 적어 주세요.", "en": "Notes must be at most {max} characters."},
    # 로그인
    "provider_not_ready": {
        "ko": "{platform} 계정 연결은 아직 준비 중입니다.",
        "en": "{platform} sign-in is not available yet.",
    },
    "login_required": {"ko": "로그인이 필요합니다.", "en": "Please sign in."},
    "account_not_linked": {
        "ko": "연결한 {platform} 계정의 대국만 볼 수 있습니다.",
        "en": "You can only view games of your linked {platform} account.",
    },
    "login_cancelled": {"ko": "로그인을 취소했습니다.", "en": "Sign-in was cancelled."},
    "login_error": {"ko": "로그인 오류: {error}", "en": "Sign-in error: {error}"},
    "login_expired": {
        "ko": "로그인 요청이 만료됐습니다. 다시 시도하세요.",
        "en": "The sign-in request expired. Please try again.",
    },
    "login_verify_failed": {
        "ko": "{platform} 로그인 확인에 실패했습니다. 다시 시도하세요.",
        "en": "Could not verify the {platform} sign-in. Please try again.",
    },
    "account_info_failed": {
        "ko": "{platform} 계정 정보를 받지 못했습니다.",
        "en": "Could not load your {platform} account.",
    },
    "account_conflict": {
        "ko": "이 계정은 이미 다른 사용자에 연결돼 있습니다. 로그아웃한 뒤 다시 시도하세요.",
        "en": "This account is already linked to another user. Sign out and try again.",
    },
}


def platform_name(platform: str, lang: Lang) -> str:
    return PLATFORM_NAMES.get(platform, {}).get(lang, platform)


def translate(code: str, lang: Lang = DEFAULT_LANG, **params: Any) -> str:
    templates = MESSAGES.get(code)
    if templates is None:
        return code
    if "platform" in params:
        params = {**params, "platform": platform_name(params["platform"], lang)}
    return templates.get(lang, templates[DEFAULT_LANG]).format(**params)


def parse_lang(accept_language: str | None) -> Lang:
    """Accept-Language에서 지원하는 언어를 고른다. 헤더가 없으면 기본 언어(한국어)."""
    if not accept_language:
        return DEFAULT_LANG
    for part in accept_language.split(","):
        tag = part.split(";")[0].strip().lower()
        if tag.startswith("ko"):
            return "ko"
        if tag.startswith("en"):
            return "en"
    return "en"


def get_lang(request: Request) -> Lang:
    return parse_lang(request.headers.get("accept-language"))


class AppError(Exception):
    """사용자에게 보여줄 오류. 문장 대신 코드와 값을 갖고, 응답할 때 요청 언어로 바꾼다."""

    status_code = 422

    def __init__(self, code: str, *, status_code: int | None = None, **params: Any):
        super().__init__(code)
        self.code = code
        self.params = params
        if status_code is not None:
            self.status_code = status_code

    def message(self, lang: Lang = DEFAULT_LANG) -> str:
        return translate(self.code, lang, **self.params)

    def __str__(self) -> str:
        return self.message()
