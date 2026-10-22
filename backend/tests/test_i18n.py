import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.analysis.engine import AnalysisService
from app.auth.access import current_user_id
from app.db import get_session
from app.i18n import AppError, parse_lang, translate
from app.importers.jobs import ImportJobManager
from app.main import create_app

EN = {"Accept-Language": "en-US,en;q=0.9"}
KO = {"Accept-Language": "ko-KR,ko;q=0.9"}


@pytest.mark.parametrize(
    "header, lang",
    [(None, "ko"), ("", "ko"), ("ko-KR,ko;q=0.9", "ko"), ("en-US,en;q=0.9", "en"), ("fr-FR,en;q=0.5", "en"), ("ja", "en")],
)
def test_parse_lang(header, lang):
    assert parse_lang(header) == lang


def test_translate_platform_names():
    assert translate("player_not_found", "ko", platform="lichess") == "리체스에서 해당 플레이어를 찾을 수 없습니다."
    assert translate("player_not_found", "en", platform="chesscom") == "Player not found on Chess.com."
    assert str(AppError("illegal_move", uci="e2e5")) == "둘 수 없는 수입니다: e2e5"


@pytest.fixture
def client(engine, link_user):
    def failing(username, on_progress):
        raise AppError("player_not_found", status_code=404, platform="chesscom")

    app = create_app(ImportJobManager({"chesscom": failing}), AnalysisService(engine, None, depth=12), init=False)
    user_id = link_user("chesscom", "x", "someone")
    app.dependency_overrides[current_user_id] = lambda: user_id

    def session_override():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = session_override
    with TestClient(app) as c:
        yield c


def test_errors_follow_accept_language(client):
    params = {"platform": "chesscom", "username": "x", "fen": "bad"}
    ko = client.get("/api/stats/position-moves", params=params, headers=KO)
    en = client.get("/api/stats/position-moves", params=params, headers=EN)
    assert ko.status_code == en.status_code == 422
    assert ko.json()["detail"].startswith("잘못된 FEN입니다")
    assert en.json()["detail"].startswith("Invalid FEN")
    assert en.json()["code"] == "invalid_fen"

    assert client.post("/api/players/chesscom/bad%20name/import", headers=EN).json()["detail"] == (
        "That is not a valid Chess.com username."
    )
    assert client.get("/api/import-jobs/nope", headers=EN).json()["detail"] == "Import job not found."


def test_job_error_is_translated_when_read(client):
    job_id = client.post("/api/players/chesscom/someone/import").json()["id"]
    # 같은 작업을 어느 언어로 조회하느냐에 따라 문장이 달라진다.
    assert client.get(f"/api/import-jobs/{job_id}", headers=KO).json()["error"] == "체스닷컴에서 해당 플레이어를 찾을 수 없습니다."
    assert client.get(f"/api/import-jobs/{job_id}", headers=EN).json()["error"] == "Player not found on Chess.com."


def test_engine_and_provider_labels(client):
    start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    body = client.get("/api/analysis/position", params={"fen": start}, headers=EN).json()
    assert body["status"] == "unavailable" and body["message"].startswith("Stockfish was not found")
    labels = {p["platform"]: p["label"] for p in client.get("/api/auth/providers", headers=EN).json()}
    assert labels == {"lichess": "Lichess", "chesscom": "Chess.com"}
