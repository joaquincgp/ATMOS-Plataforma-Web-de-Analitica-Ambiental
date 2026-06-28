from __future__ import annotations

import uuid
from datetime import datetime, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.manual_dataset import ManualDataset
from app.models.ml_experiment_run import MLExperimentRun
from app.models.user import User
from app.models.variable import Variable
from app.models.workspace import Workspace
from app.schemas.auth import UserRole
from app.schemas.ml_experiment import (
    MLExperimentRunDetail,
    MLExperimentRunRequest,
    MLExperimentRunSummary,
)
from app.services.etl.helpers import normalize_variable_code
from app.services.ml_experiments.dataset import normalized_variable_sql_expr


class MLExperimentServiceError(Exception):
    pass


class MLExperimentService:
    def __init__(self, db: Session):
        self.db = db

    def submit_run(self, *, user: User, payload: MLExperimentRunRequest) -> MLExperimentRunDetail:
        self._get_workspace(workspace_id=payload.workspace_id, user=user)
        self._validate_target_variable(payload.target_variable)
        if payload.manual_dataset_id:
            self._validate_manual_dataset_source(
                manual_dataset_id=payload.manual_dataset_id, workspace_id=payload.workspace_id, user=user
            )

        run = MLExperimentRun(
            id=str(uuid.uuid4()),
            workspace_id=payload.workspace_id,
            owner_user_id=user.id,
            algorithm=payload.algorithm,
            target_variable_code=payload.target_variable,
            station_codes=payload.station_codes,
            manual_dataset_id=payload.manual_dataset_id,
            date_from=datetime.combine(payload.date_from, time.min) if payload.date_from else None,
            date_to=datetime.combine(payload.date_to, time.min) if payload.date_to else None,
            epochs=payload.epochs,
            learning_rate=payload.learning_rate,
            train_split=payload.train_split,
            status="pending",
        )
        self.db.add(run)
        self.db.commit()
        self.db.refresh(run)
        return MLExperimentRunDetail.model_validate(run)

    def get_run(self, *, user: User, run_id: str) -> MLExperimentRunDetail:
        run = self._get_run_entity(run_id)
        self._assert_run_access(user, run)
        return MLExperimentRunDetail.model_validate(run)

    def list_runs(self, *, user: User, workspace_id: str, limit: int = 20) -> list[MLExperimentRunSummary]:
        self._get_workspace(workspace_id=workspace_id, user=user)
        statement = (
            select(MLExperimentRun)
            .where(MLExperimentRun.workspace_id == workspace_id)
            .order_by(MLExperimentRun.created_at.desc())
            .limit(limit)
        )
        runs = self.db.execute(statement).scalars().all()
        return [MLExperimentRunSummary.model_validate(run) for run in runs]

    def delete_run(self, *, user: User, run_id: str) -> None:
        run = self._get_run_entity(run_id)
        self._assert_run_access(user, run)
        self.db.delete(run)
        self.db.commit()

    def clear_run_history(self, *, user: User, workspace_id: str) -> int:
        self._get_workspace(workspace_id=workspace_id, user=user)
        statement = select(MLExperimentRun).where(MLExperimentRun.workspace_id == workspace_id)
        runs = self.db.execute(statement).scalars().all()
        count = len(runs)
        for run in runs:
            self.db.delete(run)
        self.db.commit()
        return count

    def _get_workspace(self, *, workspace_id: str, user: User) -> Workspace:
        workspace = self.db.scalar(
            select(Workspace).where(Workspace.id == workspace_id, Workspace.is_active.is_(True))
        )
        if workspace is None:
            raise MLExperimentServiceError("Workspace no encontrado.")
        if user.role != UserRole.admin.value and workspace.owner_user_id != user.id:
            raise MLExperimentServiceError("No tienes acceso a este workspace.")
        return workspace

    def _get_run_entity(self, run_id: str) -> MLExperimentRun:
        run = self.db.get(MLExperimentRun, run_id)
        if run is None:
            raise MLExperimentServiceError("Experimento no encontrado.")
        return run

    def _assert_run_access(self, user: User, run: MLExperimentRun) -> None:
        if user.role != UserRole.admin.value and run.owner_user_id != user.id:
            raise MLExperimentServiceError("No tienes acceso a este experimento.")

    def _validate_manual_dataset_source(self, *, manual_dataset_id: str, workspace_id: str, user: User) -> None:
        dataset = self.db.get(ManualDataset, manual_dataset_id)
        if dataset is None:
            raise MLExperimentServiceError("La fuente seleccionada no existe.")
        if dataset.created_for != "ml_experiments":
            raise MLExperimentServiceError("La fuente seleccionada no pertenece a ML Experiments.")
        if dataset.workspace_id != workspace_id:
            raise MLExperimentServiceError("La fuente seleccionada no pertenece a este workspace.")
        if user.role != UserRole.admin.value and dataset.owner_user_id != user.id:
            raise MLExperimentServiceError("No tienes acceso a esta fuente.")
        if dataset.status != "draft":
            raise MLExperimentServiceError(
                f"La fuente seleccionada todavía no está lista (estado: {dataset.status})."
            )

    def _validate_target_variable(self, target_variable: str) -> None:
        normalized = normalize_variable_code(target_variable)
        exists = self.db.scalar(
            select(Variable.id).where(normalized_variable_sql_expr(Variable.code) == normalized)
        )
        if exists is None:
            raise MLExperimentServiceError(
                f"La variable objetivo '{target_variable}' no existe en el catálogo de variables."
            )
