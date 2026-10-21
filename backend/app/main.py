import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
import httpx

from app.analysis.engine import AnalysisService, StockfishAnalyzer
from app.analysis.openings import get_book
from app.api import analysis, auth, openings, players, stats
from app.auth.providers import ChessComOAuth, LichessOAuth, OAuthProvider
from app.config import settings
from app.db import engine, init_db
from app.i18n import AppError, get_lang
from app.importers import chesscom, lichess
from app.importers.jobs import ImportJobManager


def _run_chesscom(username: str, on_progress) -> chesscom.ImportProgress:
    with chesscom.make_http_client(settings.user_agent) as http:
        return chesscom.import_player(
            engine,
            username,
            chesscom.ChessComClient(http),
            on_progress,
            history_years=settings.import_history_years,
        )


def _run_lichess(username: str, on_progress) -> lichess.ImportProgress:
    with lichess.make_http_client(settings.user_agent) as http:
        return lichess.import_player(
            engine,
            username,
            lichess.LichessClient(http),
            on_progress,
            history_years=settings.import_history_years,
        )


def _default_analysis_service() -> AnalysisService:
    path = settings.resolve_stockfish()
    if path is None:
        logging.getLogger(__name__).warning("Stockfish를 찾지 못해 엔진 분석을 끕니다.")
    factory = (
        (lambda: StockfishAnalyzer(path, settings.engine_depth, settings.engine_threads, settings.engine_hash_mb))
        if path
        else None
    )
    return AnalysisService(engine, factory, settings.engine_depth, settings.engine_multipv)


def _default_auth_providers() -> dict[str, OAuthProvider]:
    http = httpx.Client(headers={"User-Agent": settings.user_agent}, timeout=15.0)
    return {
        "lichess": LichessOAuth(http, settings.lichess_client_id),
        "chesscom": ChessComOAuth(http, settings.chesscom_client_id, settings.chesscom_client_secret),
    }


def create_app(
    job_manager: ImportJobManager | None = None,
    analysis_service: AnalysisService | None = None,
    auth_providers: dict[str, OAuthProvider] | None = None,
    *,
    init: bool = True,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if init:
            init_db()
        get_book()  # 오프닝 목록 색인(약 1초)을 첫 요청 전에 끝내 둔다.
        if app.state.analysis_service is None:
            app.state.analysis_service = _default_analysis_service()
        yield
        app.state.analysis_service.shutdown()

    app = FastAPI(title="Hansu (한수)", lifespan=lifespan)
    app.state.job_manager = job_manager or ImportJobManager(
        {"chesscom": _run_chesscom, "lichess": _run_lichess}
    )
    app.state.analysis_service = analysis_service
    app.state.auth_providers = auth_providers or _default_auth_providers()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # 로그인 상태(user_id)를 서명된 쿠키에 둔다. 30일 유지.
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.secret_key,
        session_cookie="chess_review_session",
        max_age=30 * 24 * 3600,
        same_site="lax",
        https_only=settings.public_base_url.startswith("https://"),
    )
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.message(get_lang(request)), "code": exc.code},
        )

    app.include_router(players.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(stats.router, prefix="/api")
    app.include_router(analysis.router, prefix="/api")
    app.include_router(openings.router, prefix="/api")
    return app


logging.basicConfig(level=logging.INFO)
app = create_app()
