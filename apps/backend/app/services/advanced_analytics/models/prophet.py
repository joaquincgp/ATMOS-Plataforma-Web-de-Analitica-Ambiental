from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.schemas.advanced_analytics import AdvancedAnalyticsRequest

_PROPHET_FREQ_MAP = {
    "hour": "h",
    "day": "D",
    "week": "W-MON",
    "month": "MS",
    "quarter": "QS",
    "year": "YS",
}

_MPL_CACHE_DIR = Path("/tmp/atmos-mpl-cache")


def fit_prophet_model(
    series: pd.Series,
    payload: AdvancedAnalyticsRequest,
    *,
    error_cls: type[Exception],
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    prophet_class = _load_prophet(error_cls)
    clean_series = series.dropna()
    prophet_frame = pd.DataFrame(
        {
            "ds": clean_series.index.tz_convert("UTC").tz_localize(None),
            "y": clean_series.to_numpy(dtype=float),
        }
    )
    try:
        model = prophet_class(interval_width=0.95)
        model.fit(prophet_frame)
        future = model.make_future_dataframe(
            periods=payload.horizon,
            freq=_PROPHET_FREQ_MAP[payload.granularity],
            include_history=True,
        )
        prediction = model.predict(future)
    except Exception as exc:  # noqa: BLE001
        raise error_cls(f"No se pudo ajustar el modelo PROPHET: {exc}") from exc

    history_len = len(prophet_frame)
    fitted_slice = prediction.iloc[:history_len].copy()
    forecast_slice = prediction.iloc[history_len:].copy()

    fitted_frame = pd.DataFrame(
        {
            "bucket": pd.to_datetime(fitted_slice["ds"], utc=True, errors="coerce"),
            "observed": clean_series.to_numpy(dtype=float),
            "fitted": fitted_slice["yhat"].to_numpy(dtype=float),
        }
    )
    forecast_frame = pd.DataFrame(
        {
            "bucket": pd.to_datetime(forecast_slice["ds"], utc=True, errors="coerce"),
            "forecast": forecast_slice["yhat"].to_numpy(dtype=float),
            "lower": forecast_slice["yhat_lower"].to_numpy(dtype=float),
            "upper": forecast_slice["yhat_upper"].to_numpy(dtype=float),
        }
    )

    residuals = fitted_frame["observed"] - fitted_frame["fitted"]
    rmse = float(np.sqrt(np.mean(np.square(residuals)))) if not fitted_frame.empty else 0.0
    mae = float(np.mean(np.abs(residuals))) if not fitted_frame.empty else 0.0
    stats = {
        "aic": None,
        "bic": None,
        "rmse": rmse,
        "mae": mae,
    }
    return fitted_frame, forecast_frame, stats


def _load_prophet(error_cls: type[Exception]) -> Any:
    try:
        _MPL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("MPLCONFIGDIR", str(_MPL_CACHE_DIR))
        logging.getLogger("cmdstanpy").setLevel(logging.WARNING)
        from prophet import Prophet
    except ModuleNotFoundError as exc:
        raise error_cls(
            "Advanced Analytics requiere prophet en el entorno del backend. "
            "Instálalo en apps/backend/.venv antes de usar Prophet."
        ) from exc

    return Prophet
