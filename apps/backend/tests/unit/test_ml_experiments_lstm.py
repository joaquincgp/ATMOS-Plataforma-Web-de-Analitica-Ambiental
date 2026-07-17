# Fast synthetic-data smoke tests for the LSTM ModelRunner (no DB involved).
from __future__ import annotations

# pylint: disable=no-member  # pandas DatetimeIndex.hour/.dayofweek not inferred by pylint
import math

import numpy as np
import pandas as pd
import pytest

from app.services.ml_experiments.dataset import MLDataset
from app.services.ml_experiments.models.lstm import LstmModelRunner

FEATURE_NAMES = ["Temperature", "Humidity", "Wind Speed", "Hour of Day", "Day of Week"]
TARGET_NAME = "PM2.5 Concentration"


def _build_synthetic_dataset(rows: int = 200) -> MLDataset:
    rng = np.random.default_rng(0)
    index = pd.date_range("2025-01-01", periods=rows, freq="h")
    hours = index.hour.to_numpy()
    target = 20 + 5 * np.sin(2 * np.pi * hours / 24) + rng.normal(scale=0.5, size=rows)
    temperature = 15 + 3 * np.cos(2 * np.pi * hours / 24)
    humidity = 60 + rng.normal(scale=2, size=rows)
    wind_speed = 5 + rng.normal(scale=1, size=rows)

    frame = pd.DataFrame(
        {
            TARGET_NAME: target,
            "Temperature": temperature,
            "Humidity": humidity,
            "Wind Speed": wind_speed,
            "Hour of Day": hours,
            "Day of Week": index.dayofweek,
        },
        index=index,
    )
    split_index = int(rows * 0.8)
    return MLDataset(
        train_df=frame.iloc[:split_index].copy(),
        test_df=frame.iloc[split_index:].copy(),
        feature_names=FEATURE_NAMES,
        target_name=TARGET_NAME,
        station_codes_used=["A"],
    )


def test_lstm_runner_produces_full_result_contract() -> None:
    dataset = _build_synthetic_dataset()
    runner = LstmModelRunner()

    result = runner.train(dataset, epochs=3, learning_rate=0.01, seed=42)

    assert len(result.loss_curve) == 3
    assert [point["epoch"] for point in result.loss_curve] == [1, 2, 3]
    assert len(result.rmse_curve) == 3
    assert result.final_rmse >= 0
    assert math.isfinite(result.final_rmse)
    assert len(result.feature_importance) == len(FEATURE_NAMES)
    assert {item["feature"] for item in result.feature_importance} == set(FEATURE_NAMES)
    assert pytest.approx(sum(item["importance"] for item in result.feature_importance), abs=1e-6) == 1.0
    assert len(result.predictions) == len(dataset.test_df) - result.extra_stats["lookback_hours"]
    assert math.isfinite(result.r_squared)
    assert len(result.rmse_ci) == 2
    assert result.rmse_ci[0] <= result.rmse_ci[1]
    assert all(math.isfinite(bound) for bound in result.rmse_ci)
    assert len(result.r_squared_ci) == 2
    assert result.r_squared_ci[0] <= result.r_squared_ci[1]
    assert all(math.isfinite(bound) for bound in result.r_squared_ci)


def test_lstm_runner_reports_progress_per_epoch() -> None:
    dataset = _build_synthetic_dataset()
    runner = LstmModelRunner()
    progress: list[tuple[int, dict[str, float]]] = []

    runner.train(
        dataset,
        epochs=2,
        learning_rate=0.01,
        seed=42,
        progress_callback=lambda epoch, metrics: progress.append((epoch, metrics)),
    )

    assert [call[0] for call in progress] == [1, 2]
    assert all(math.isfinite(call[1]["train_loss"]) for call in progress)


def test_lstm_runner_is_deterministic_for_a_fixed_seed() -> None:
    dataset = _build_synthetic_dataset()
    runner = LstmModelRunner()

    first = runner.train(dataset, epochs=2, learning_rate=0.01, seed=7)
    second = runner.train(dataset, epochs=2, learning_rate=0.01, seed=7)

    assert first.final_rmse == pytest.approx(second.final_rmse)
    assert first.loss_curve == second.loss_curve
