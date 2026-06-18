from __future__ import annotations

import asyncio
import logging
import os
import socket
import time
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import select

from app.core.time import ecuador_now_naive
from app.db.session import SessionLocal
from app.models.ml_experiment_run import MLExperimentRun
from app.services.ml_experiments import get_runner
from app.services.ml_experiments.dataset import MLExperimentError, build_ml_dataset
from app.services.ml_experiments.registry import ModelNotImplementedError

logger = logging.getLogger(__name__)

# Dedicated single-thread executor for CPU-bound training so it never blocks the
# asyncio event loop. One worker is intentional: training is CPU/BLAS-bound, not
# something that benefits from extra Python-level threads, and it keeps memory
# bounded and jobs strictly serialized on a single-replica deployment.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ml-train")
_worker_identity = f"{socket.gethostname()}:{os.getpid()}"


def _claim_next_job() -> str | None:
    db = SessionLocal()
    try:
        statement = (
            select(MLExperimentRun)
            .where(MLExperimentRun.status == "pending")
            .order_by(MLExperimentRun.created_at.asc())
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        run = db.execute(statement).scalar_one_or_none()
        if run is None:
            return None
        run.status = "running"
        run.claimed_at = ecuador_now_naive()
        run.claimed_by = _worker_identity
        run.started_at = ecuador_now_naive()
        db.commit()
        return run.id
    finally:
        db.close()


def _persist_progress(run_id: str, epoch: int) -> None:
    db = SessionLocal()
    try:
        run = db.get(MLExperimentRun, run_id)
        if run is not None:
            run.progress_epoch = epoch
            db.commit()
    finally:
        db.close()


def _mark_failed(run_id: str, message: str) -> None:
    db = SessionLocal()
    try:
        run = db.get(MLExperimentRun, run_id)
        if run is not None:
            run.status = "failed"
            run.error_message = message
            run.finished_at = ecuador_now_naive()
            db.commit()
    finally:
        db.close()


def _execute_job(run_id: str) -> None:
    db = SessionLocal()
    try:
        run = db.get(MLExperimentRun, run_id)
        if run is None:
            return

        start_time = time.monotonic()
        try:
            dataset = build_ml_dataset(
                db,
                target_variable_code=run.target_variable_code,
                station_codes=run.station_codes,
                date_from=run.date_from.date() if run.date_from else None,
                date_to=run.date_to.date() if run.date_to else None,
                train_split=run.train_split,
            )
            runner = get_runner(run.algorithm)
            result = runner.train(
                dataset,
                epochs=run.epochs,
                learning_rate=run.learning_rate,
                progress_callback=lambda epoch, _metrics: _persist_progress(run_id, epoch),
            )
            training_seconds = round(time.monotonic() - start_time, 2)

            run.loss_curve = result.loss_curve
            run.rmse_curve = result.rmse_curve
            run.final_rmse = result.final_rmse
            run.feature_importance = result.feature_importance
            run.predictions = result.predictions
            run.r_squared = result.r_squared
            run.dataset_stats = {
                "train_rows": len(dataset.train_df),
                "test_rows": len(dataset.test_df),
                "feature_names": dataset.feature_names,
                "station_codes_used": dataset.station_codes_used,
                "training_time_seconds": training_seconds,
                "warnings": dataset.warnings,
                **result.extra_stats,
            }
            run.status = "completed"
            run.finished_at = ecuador_now_naive()
            db.commit()
        except (MLExperimentError, ModelNotImplementedError) as exc:
            db.rollback()
            _mark_failed(run_id, str(exc))
        except Exception:
            logger.exception("ML experiment run %s failed unexpectedly.", run_id)
            db.rollback()
            _mark_failed(run_id, "El entrenamiento falló inesperadamente. Revisa los logs del backend.")
    finally:
        db.close()


async def ml_job_worker_loop(poll_interval_seconds: float = 2.0) -> None:
    loop = asyncio.get_running_loop()
    while True:
        try:
            run_id = await loop.run_in_executor(None, _claim_next_job)
            if run_id is None:
                await asyncio.sleep(poll_interval_seconds)
                continue
            await loop.run_in_executor(_executor, _execute_job, run_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("ML job worker loop iteration failed unexpectedly.")
            await asyncio.sleep(poll_interval_seconds)
