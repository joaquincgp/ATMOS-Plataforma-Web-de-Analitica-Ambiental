from __future__ import annotations

from collections.abc import Callable

import numpy as np
import torch
from torch import nn

from app.services.ml_experiments.dataset import MLDataset, MLExperimentError
from app.services.ml_experiments.runner import MLTrainingResult

DEFAULT_LOOKBACK_HOURS = 24
MIN_LOOKBACK_HOURS = 2
D_MODEL = 32
N_HEAD = 2
NUM_LAYERS = 1
DIM_FEEDFORWARD = 64
DROPOUT = 0.1


class _TransformerRegressor(nn.Module):
    def __init__(
        self,
        input_dim: int,
        d_model: int = D_MODEL,
        n_head: int = N_HEAD,
        num_layers: int = NUM_LAYERS,
        dim_feedforward: int = DIM_FEEDFORWARD,
        dropout: float = DROPOUT,
        max_lookback: int = DEFAULT_LOOKBACK_HOURS,
    ) -> None:
        super().__init__()
        self.input_projection = nn.Linear(input_dim, d_model)
        self.positional_embedding = nn.Parameter(torch.randn(max_lookback, d_model) * 0.02)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_head,
            dim_feedforward=dim_feedforward,
            dropout=dropout,
            batch_first=True,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.head = nn.Linear(d_model, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        seq_len = x.shape[1]
        projected = self.input_projection(x) + self.positional_embedding[:seq_len]
        encoded = self.encoder(projected)
        return self.head(encoded[:, -1, :]).squeeze(-1)


def _resolve_lookback(train_len: int, test_len: int) -> int:
    candidate = min(DEFAULT_LOOKBACK_HOURS, train_len - 1, test_len - 1)
    return max(MIN_LOOKBACK_HOURS, candidate)


def _build_windows(
    frame_values: np.ndarray,
    target_index: int,
    lookback: int,
) -> tuple[np.ndarray, np.ndarray]:
    n_windows = len(frame_values) - lookback
    if n_windows <= 0:
        raise MLExperimentError(
            "No hay suficientes observaciones para construir las ventanas de entrenamiento del Transformer."
        )
    n_columns = frame_values.shape[1]
    x = np.zeros((n_windows, lookback, n_columns), dtype=np.float32)
    y = np.zeros((n_windows,), dtype=np.float32)
    for i in range(n_windows):
        x[i] = frame_values[i : i + lookback]
        y[i] = frame_values[i + lookback, target_index]
    return x, y


def _r_squared(actual: np.ndarray, predicted: np.ndarray) -> float:
    ss_res = float(np.sum((actual - predicted) ** 2))
    ss_tot = float(np.sum((actual - np.mean(actual)) ** 2))
    if ss_tot <= 0:
        return 0.0
    return 1.0 - ss_res / ss_tot


def _rmse(actual: np.ndarray, predicted: np.ndarray) -> float:
    return float(np.sqrt(np.mean((actual - predicted) ** 2)))


def _bootstrap_metric_ci(
    actual: np.ndarray,
    predicted: np.ndarray,
    metric_fn: Callable[[np.ndarray, np.ndarray], float],
    rng: np.random.Generator,
    n_resamples: int = 500,
    confidence: float = 0.95,
) -> tuple[float, float]:
    """95% bootstrap CI: resample (actual, predicted) pairs with replacement
    n_resamples times, recompute the metric on each resample, and report the
    percentile interval of the resulting distribution. With a single test
    point every resample is identical, so the interval correctly collapses to
    a single value rather than erroring."""
    n = len(actual)
    estimates = np.empty(n_resamples, dtype=np.float64)
    for i in range(n_resamples):
        indices = rng.integers(0, n, size=n)
        estimates[i] = metric_fn(actual[indices], predicted[indices])
    lower_percentile = (1 - confidence) / 2 * 100
    upper_percentile = (1 + confidence) / 2 * 100
    return float(np.percentile(estimates, lower_percentile)), float(np.percentile(estimates, upper_percentile))


def _split_train_validation(
    x: np.ndarray, y: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    n_windows = len(x)
    if n_windows < 2:
        return x, y, x, y
    val_size = max(1, min(n_windows - 1, round(n_windows * 0.2)))
    return x[:-val_size], y[:-val_size], x[-val_size:], y[-val_size:]


def _permutation_importance(
    model: _TransformerRegressor,
    x_test: np.ndarray,
    y_test: np.ndarray,
    feature_names: list[str],
    feature_start_index: int,
    baseline_rmse_norm: float,
    rng: np.random.Generator,
) -> list[dict[str, float]]:
    raw_importances: dict[str, float] = {}
    for offset, name in enumerate(feature_names):
        column_index = feature_start_index + offset
        shuffled = x_test.copy()
        permutation = rng.permutation(len(shuffled))
        shuffled[:, :, column_index] = shuffled[permutation, :, column_index]
        with torch.no_grad():
            preds = model(torch.from_numpy(shuffled)).numpy()
        rmse_norm = float(np.sqrt(np.mean((preds - y_test) ** 2)))
        raw_importances[name] = max(0.0, rmse_norm - baseline_rmse_norm)

    total = sum(raw_importances.values())
    if total <= 0:
        equal_share = 1.0 / len(feature_names)
        return [{"feature": name, "importance": equal_share} for name in feature_names]
    return [{"feature": name, "importance": value / total} for name, value in raw_importances.items()]


class TransformerModelRunner:
    def train(
        self,
        dataset: MLDataset,
        *,
        epochs: int,
        learning_rate: float,
        progress_callback: Callable[[int, dict[str, float]], None] | None = None,
        seed: int = 42,
    ) -> MLTrainingResult:
        torch.manual_seed(seed)
        rng = np.random.default_rng(seed)

        columns = [dataset.target_name, *dataset.feature_names]
        train_df = dataset.train_df[columns]
        test_df = dataset.test_df[columns]

        means = train_df.mean()
        stds = train_df.std().replace(0, 1.0).fillna(1.0)
        train_norm = ((train_df - means) / stds).to_numpy(dtype=np.float32)
        test_norm = ((test_df - means) / stds).to_numpy(dtype=np.float32)

        lookback = _resolve_lookback(len(train_norm), len(test_norm))
        x_train_full, y_train_full = _build_windows(train_norm, target_index=0, lookback=lookback)
        x_test, y_test = _build_windows(test_norm, target_index=0, lookback=lookback)
        x_train, y_train, x_val, y_val = _split_train_validation(x_train_full, y_train_full)

        model = _TransformerRegressor(input_dim=len(columns), max_lookback=lookback)
        optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)
        loss_fn = nn.MSELoss()

        x_train_t = torch.from_numpy(x_train)
        y_train_t = torch.from_numpy(y_train)
        x_val_t = torch.from_numpy(x_val)
        y_val_t = torch.from_numpy(y_val)

        target_std = float(stds[dataset.target_name])
        target_mean = float(means[dataset.target_name])

        loss_curve: list[dict[str, float]] = []
        rmse_curve: list[dict[str, float]] = []

        for epoch in range(1, epochs + 1):
            model.train()
            optimizer.zero_grad()
            train_preds = model(x_train_t)
            train_loss = loss_fn(train_preds, y_train_t)
            train_loss.backward()
            optimizer.step()

            model.eval()
            with torch.no_grad():
                val_loss = loss_fn(model(x_val_t), y_val_t).item()
            val_rmse = float(np.sqrt(val_loss) * target_std)

            loss_curve.append({"epoch": epoch, "train_loss": float(train_loss.item()), "val_loss": float(val_loss)})
            rmse_curve.append({"epoch": epoch, "rmse": val_rmse})
            if progress_callback is not None:
                progress_callback(
                    epoch,
                    {"train_loss": float(train_loss.item()), "val_loss": float(val_loss), "rmse": val_rmse},
                )

        model.eval()
        with torch.no_grad():
            test_preds_norm = model(torch.from_numpy(x_test)).numpy()

        test_actual = y_test * target_std + target_mean
        test_predicted = test_preds_norm * target_std + target_mean
        final_rmse = _rmse(test_actual, test_predicted)
        r_squared = _r_squared(test_actual, test_predicted)
        rmse_ci = _bootstrap_metric_ci(test_actual, test_predicted, _rmse, rng=rng)
        r_squared_ci = _bootstrap_metric_ci(test_actual, test_predicted, _r_squared, rng=rng)

        baseline_rmse_norm = float(np.sqrt(np.mean((test_preds_norm - y_test) ** 2)))
        feature_importance = _permutation_importance(
            model,
            x_test,
            y_test,
            feature_names=dataset.feature_names,
            feature_start_index=1,
            baseline_rmse_norm=baseline_rmse_norm,
            rng=rng,
        )

        predictions = [
            {"actual": float(actual), "predicted": float(predicted)}
            for actual, predicted in zip(test_actual, test_predicted, strict=True)
        ]

        return MLTrainingResult(
            loss_curve=loss_curve,
            rmse_curve=rmse_curve,
            final_rmse=final_rmse,
            feature_importance=feature_importance,
            predictions=predictions,
            r_squared=r_squared,
            rmse_ci=rmse_ci,
            r_squared_ci=r_squared_ci,
            extra_stats={
                "lookback_hours": lookback,
                "train_windows": len(x_train),
                "validation_windows": len(x_val),
                "test_windows": len(x_test),
            },
        )
