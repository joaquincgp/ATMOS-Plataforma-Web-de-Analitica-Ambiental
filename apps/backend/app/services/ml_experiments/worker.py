from __future__ import annotations

import asyncio
import logging
import os
import socket
import time
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import ecuador_now_naive
from app.db.session import SessionLocal
from app.models.manual_dataset import ManualDataset
from app.models.ml_experiment_run import MLExperimentRun
from app.models.user import User
from app.services.manual_dataset import ManualDatasetError, ManualDatasetService
from app.services.ml_experiments import get_runner_lazy
from app.services.ml_experiments.dataset import MLExperimentError, build_ml_dataset
from app.services.ml_experiments.registry import ModelNotImplementedError

logger = logging.getLogger(__name__)

_RESTART_INTERRUPTION_MESSAGE = "El proceso se interrumpió porque el servidor se reinició. Intenta nuevamente."


def reset_orphaned_jobs() -> None:
    """Marks ML-Experiments runs/source syncs left mid-flight by a process
    that died (crash, redeploy, scale-to-zero) as failed, instead of leaving
    them stuck in 'running'/'syncing' forever with no way to retry. Meant to
    run once at startup, before the worker loop starts claiming new work.
    """
    db = SessionLocal()
    try:
        stuck_runs = db.execute(select(MLExperimentRun).where(MLExperimentRun.status == "running")).scalars().all()
        for run in stuck_runs:
            run.status = "failed"
            run.error_message = _RESTART_INTERRUPTION_MESSAGE
            run.finished_at = ecuador_now_naive()

        stuck_sources = (
            db.execute(
                select(ManualDataset).where(
                    ManualDataset.created_for == "ml_experiments",
                    ManualDataset.status == "syncing",
                )
            )
            .scalars()
            .all()
        )
        for source in stuck_sources:
            source.status = "failed"
            source.error_message = _RESTART_INTERRUPTION_MESSAGE

        if stuck_runs or stuck_sources:
            db.commit()
            logger.warning(
                "Reset %d orphaned ML run(s) and %d orphaned source sync(s) after a restart.",
                len(stuck_runs),
                len(stuck_sources),
            )
    finally:
        db.close()

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


def _load_source_frame(db: Session, run: MLExperimentRun) -> pd.DataFrame | None:
    if not run.manual_dataset_id:
        return None
    owner = db.get(User, run.owner_user_id)
    if owner is None:
        raise MLExperimentError("No se pudo verificar el propietario del experimento.")
    service = ManualDatasetService(db)
    try:
        frame = service.get_source_dataframe(dataset_id=run.manual_dataset_id, user=owner)
    except ManualDatasetError as exc:
        # The source file was lost (container restarted and ephemeral disk was
        # wiped). Fall back to the shared measurements table — the ETL sync that
        # created this dataset also wrote the same rows there, so training still
        # produces correct results. Log so the issue is visible in the logs.
        logger.warning(
            "Archivo físico del dataset %s no disponible (%s). "
            "El entrenamiento usará las mediciones en base de datos como alternativa.",
            run.manual_dataset_id,
            exc,
        )
        return None
    frame = frame.copy()
    frame["observed_at"] = pd.to_datetime(frame["observed_at"], errors="coerce")
    return frame


def _execute_job(run_id: str) -> None:
    db = SessionLocal()
    try:
        run = db.get(MLExperimentRun, run_id)
        if run is None:
            return

        start_time = time.monotonic()
        try:
            source_frame = _load_source_frame(db, run)
            dataset = build_ml_dataset(
                db,
                target_variable_code=run.target_variable_code,
                station_codes=run.station_codes,
                date_from=run.date_from.date() if run.date_from else None,
                date_to=run.date_to.date() if run.date_to else None,
                train_split=run.train_split,
                source_frame=source_frame,
            )
            runner = get_runner_lazy(run.algorithm)
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
            run.final_rmse_ci_low, run.final_rmse_ci_high = result.rmse_ci
            run.feature_importance = result.feature_importance
            run.predictions = result.predictions
            run.r_squared = result.r_squared
            run.r_squared_ci_low, run.r_squared_ci_high = result.r_squared_ci
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
