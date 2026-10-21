from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlmodel import Session

from app.analysis.stats import list_players, player_summary
from app.db import get_session
from app.importers.base import ImporterError
from app.importers import chesscom, lichess
from app.importers.jobs import ImportJob, ImportJobManager
from app.config import settings
from app.models.schemas import (
    ImportJobOut,
    ImportSettingsOut,
    Platform,
    PlayerSummaryOut,
    SavedPlayerOut,
)

router = APIRouter(tags=["players"])


def get_job_manager(request: Request) -> ImportJobManager:
    return request.app.state.job_manager


def _job_out(job: ImportJob) -> ImportJobOut:
    return ImportJobOut.model_validate(job, from_attributes=True)


VALIDATORS = {"chesscom": chesscom.validate_username, "lichess": lichess.validate_username}


def _check_username(platform: Platform, username: str) -> str:
    try:
        return VALIDATORS[platform](username)
    except ImporterError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.post(
    "/players/{platform}/{username}/import",
    response_model=ImportJobOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_import(
    platform: Platform,
    username: str,
    background: BackgroundTasks,
    response: Response,
    jobs: ImportJobManager = Depends(get_job_manager),
):
    """플레이어의 대국을 백그라운드에서 가져온다. 진행 상황은 /import-jobs/{id}로 조회한다."""
    username = _check_username(platform, username)
    job, created = jobs.create(platform, username)
    if created:
        background.add_task(jobs.run, job.id)
    else:
        response.status_code = status.HTTP_200_OK
    return _job_out(job)


@router.get("/import-jobs/{job_id}", response_model=ImportJobOut)
def get_import_job(job_id: str, jobs: ImportJobManager = Depends(get_job_manager)):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "작업을 찾을 수 없습니다.")
    return _job_out(job)


@router.get("/import-settings", response_model=ImportSettingsOut)
def get_import_settings():
    """처음 가져올 때 받는 기간 등, 가져오기 화면에 보여줄 설정."""
    return ImportSettingsOut(history_years=settings.import_history_years)


@router.get("/players", response_model=list[SavedPlayerOut])
def get_players(platform: Platform | None = None, session: Session = Depends(get_session)):
    """대국을 가져온 적 있는 플레이어 목록 (최근에 가져온 순)."""
    return list_players(session, platform)


@router.get("/players/{platform}/{username}", response_model=PlayerSummaryOut)
def get_player(platform: Platform, username: str, session: Session = Depends(get_session)):
    username = _check_username(platform, username)
    summary = player_summary(session, platform, username)
    if not summary["saved"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "아직 가져오지 않은 플레이어입니다.")
    return summary
