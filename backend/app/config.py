import os
import secrets
import shutil
from dataclasses import dataclass, field
from pathlib import Path

# 기본 DB는 실행 위치와 무관하게 항상 backend/data/chess.db에 둔다.
DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "chess.db"
SECRET_KEY_FILE = DEFAULT_DB_PATH.parent / "secret_key"


def _secret_key() -> str:
    """세션 쿠키 서명 키. SECRET_KEY가 없으면 개발용으로 data/secret_key에 한 번 만들어 쓴다."""
    if key := os.getenv("SECRET_KEY"):
        return key
    if SECRET_KEY_FILE.exists():
        return SECRET_KEY_FILE.read_text(encoding="utf-8").strip()
    SECRET_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_urlsafe(48)
    SECRET_KEY_FILE.write_text(key, encoding="utf-8")
    return key


@dataclass(frozen=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH.as_posix()}")
    )
    # 체스닷컴/리체스 요청에 붙일 연락처(이메일 등). 비어 있으면 연락처 없이 보낸다.
    user_agent_contact: str = field(default_factory=lambda: os.getenv("USER_AGENT_CONTACT", ""))
    # 비어 있으면 PATH에서 stockfish를 찾는다.
    stockfish_path: str = field(default_factory=lambda: os.getenv("STOCKFISH_PATH", ""))
    # 처음 가져올 때 받는 기간(년). 이후 업데이트는 마지막 대국 이후만 받는다.
    import_history_years: int = field(default_factory=lambda: int(os.getenv("IMPORT_HISTORY_YEARS", "3")))
    engine_depth: int = field(default_factory=lambda: int(os.getenv("ENGINE_DEPTH", "18")))
    engine_threads: int = field(
        default_factory=lambda: int(os.getenv("ENGINE_THREADS", str(max(1, (os.cpu_count() or 2) // 2))))
    )
    engine_multipv: int = field(default_factory=lambda: int(os.getenv("ENGINE_MULTIPV", "3")))
    engine_hash_mb: int = field(default_factory=lambda: int(os.getenv("ENGINE_HASH_MB", "128")))
    secret_key: str = field(default_factory=_secret_key)
    # 사용자가 브라우저로 여는 주소. OAuth 콜백(/api/auth/.../callback)과 로그인 후 돌아갈 곳을 만든다.
    public_base_url: str = field(
        default_factory=lambda: os.getenv("PUBLIC_BASE_URL", "http://localhost:5173").rstrip("/")
    )
    # 리체스는 사전 등록 없이 아무 고유 client_id로 OAuth(PKCE)를 쓸 수 있다.
    lichess_client_id: str = field(default_factory=lambda: os.getenv("LICHESS_CLIENT_ID", "myosu"))
    # 체스닷컴 OAuth는 승인 후 받은 값을 넣는다. 비어 있으면 체스닷컴 계정 연결을 끈다.
    chesscom_client_id: str = field(default_factory=lambda: os.getenv("CHESSCOM_CLIENT_ID", ""))
    chesscom_client_secret: str = field(default_factory=lambda: os.getenv("CHESSCOM_CLIENT_SECRET", ""))
    cors_origins: list[str] = field(
        default_factory=lambda: os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    )

    def resolve_stockfish(self) -> str | None:
        return self.stockfish_path or shutil.which("stockfish")

    @property
    def user_agent(self) -> str:
        base = "myosu/0.1"
        return f"{base} (contact: {self.user_agent_contact})" if self.user_agent_contact else base


settings = Settings()
