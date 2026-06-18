from __future__ import annotations

from collections.abc import Callable

import numpy as np
import torch
from torch import nn

from app.services.ml_experiments.dataset import MLDataset, MLExperimentError
from app.services.ml_experiments.runner import MLTrainingResult

DEFAULT_LOOKBACK_HOURS = 24
MIN_LOOKBACK_HOURS = 2
HIDDEN_SIZE = 32


class _LstmRegressor(nn.Module):
    def __init__(self, input_dim: int, hidden_size: int = HIDDEN_SIZE) -> None:
        super().__init__()
        self.lstm = nn.LSTM(input_dim, hidden_size, num_layers=1, batch_first=True)
        self.head = nn.Linear(hidden_size, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        output, _ = self.lstm(x)
        return self.head(output[:, -1, :]).squeeze(-1)


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
            "No hay suficientes observaciones para construir las ventanas de entrenamiento del LSTM."
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


def _split_train_validation(
    x: np.ndarray, y: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    n_windows = len(x)
    if n_windows < 2:
        return x, y, x, y
    val_size = max(1, min(n_windows - 1, round(n_windows * 0.2)))
    return x[:-val_size], y[:-val_size], x[-val_size:], y[-val_size:]


def _permutation_importance(
    model: _LstmRegressor,
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


class LstmModelRunner:
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

        model = _LstmRegressor(input_dim=len(columns))
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
        final_rmse = float(np.sqrt(np.mean((test_predicted - test_actual) ** 2)))
        r_squared = _r_squared(test_actual, test_predicted)

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
            extra_stats={
                "lookback_hours": lookback,
                "train_windows": len(x_train),
                "validation_windows": len(x_val),
                "test_windows": len(x_test),
            },
        )
