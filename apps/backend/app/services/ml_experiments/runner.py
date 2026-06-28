from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.services.ml_experiments.dataset import MLDataset


@dataclass(frozen=True)
class MLTrainingResult:
    loss_curve: list[dict[str, float]]
    rmse_curve: list[dict[str, float]]
    final_rmse: float
    feature_importance: list[dict[str, float]]
    predictions: list[dict[str, float]]
    r_squared: float
    # 95% bootstrap confidence intervals (resampling the test-set predictions
    # with replacement), so the point estimates above can be reported with a
    # measure of statistical uncertainty rather than as a single bare number.
    rmse_ci: tuple[float, float]
    r_squared_ci: tuple[float, float]
    extra_stats: dict[str, Any] = field(default_factory=dict)


class ModelRunner(Protocol):
    """Implemented by every algorithm: lstm, gru, and (later) remote foundation-model runners."""

    def train(
        self,
        dataset: MLDataset,
        *,
        epochs: int,
        learning_rate: float,
        progress_callback: Callable[[int, dict[str, float]], None] | None = None,
        seed: int = 42,
    ) -> MLTrainingResult: ...
