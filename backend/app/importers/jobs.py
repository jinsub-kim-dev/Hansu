"""백그라운드 수집 작업 관리.

외부 API에 동시에 한 요청만 보내도록 수집 작업은 전역 락으로 한 번에 하나씩 실행한다.
작업 상태는 메모리에만 둔다(대국 데이터 자체는 DB에 저장된다).
"""

import logging
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from app.i18n import AppError
from app.importers.base import ImportProgress, ProgressCallback

log = logging.getLogger(__name__)

JobStatus = Literal["queued", "running", "done", "error"]
Runner = Callable[[str, ProgressCallback], ImportProgress]


@dataclass
class ImportJob:
    id: str
    platform: str
    username: str
    status: JobStatus = "queued"
    progress: ImportProgress = field(default_factory=ImportProgress)
    error: AppError | None = None  # 조회하는 요청의 언어로 문장을 만든다
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    finished_at: datetime | None = None


class ImportJobManager:
    def __init__(self, runners: dict[str, Runner]):
        self.runners = runners
        self._jobs: dict[str, ImportJob] = {}
        self._lock = threading.Lock()  # _jobs 보호
        self._run_lock = threading.Lock()  # 수집을 한 번에 하나씩

    def create(self, platform: str, username: str) -> tuple[ImportJob, bool]:
        """작업을 만든다. 같은 플레이어의 작업이 이미 진행 중이면 그 작업을 돌려준다.

        두 번째 값은 새로 만들었는지 여부.
        """
        username = username.lower()
        with self._lock:
            for job in self._jobs.values():
                if (
                    job.platform == platform
                    and job.username == username
                    and job.status in ("queued", "running")
                ):
                    return job, False
            job = ImportJob(id=uuid.uuid4().hex, platform=platform, username=username)
            self._jobs[job.id] = job
            return job, True

    def get(self, job_id: str) -> ImportJob | None:
        return self._jobs.get(job_id)

    def run(self, job_id: str) -> None:
        job = self._jobs[job_id]
        with self._run_lock:
            job.status = "running"

            def on_progress(p: ImportProgress) -> None:
                job.progress = ImportProgress(**p.__dict__)

            try:
                job.progress = self.runners[job.platform](job.username, on_progress)
                job.status = "done"
            except AppError as exc:  # 사용자에게 보여줄 오류(수집기 오류 포함)
                job.status, job.error = "error", exc
            except Exception:
                log.exception("수집 작업 실패: %s", job_id)
                job.status, job.error = "error", AppError("import_failed")
            finally:
                job.finished_at = datetime.now(UTC)
