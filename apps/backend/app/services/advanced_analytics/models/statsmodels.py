from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.schemas.advanced_analytics import AdvancedAnalyticsRequest


def fit_statsmodels_model(
    series: pd.Series,
    payload: AdvancedAnalyticsRequest,
    *,
    error_cls: type[Exception],
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    arima_class, sarimax_class = _load_statsmodels(error_cls)
    clean_series = series.dropna()
    order = tuple(int(value) for value in payload.order)
    try:
        if payload.model == "sarima":
            if payload.seasonal_order is None:
                raise error_cls("SARIMA requiere seasonal_order con cuatro valores.")
            seasonal_order = tuple(int(value) for value in payload.seasonal_order)
            model = sarimax_class(
                clean_series,
                order=order,
                seasonal_order=seasonal_order,
                enforce_stationarity=False,
                enforce_invertibility=False,
            )
        else:
            model = arima_class(
                clean_series,
                order=order,
                enforce_stationarity=False,
                enforce_invertibility=False,
            )
        fitted = model.fit()
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, error_cls):
            raise
        raise error_cls(f"No se pudo ajustar el modelo {payload.model.upper()}: {exc}") from exc

    prediction = fitted.get_prediction(start=clean_series.index[0], end=clean_series.index[-1])
    predicted_mean = prediction.predicted_mean.reindex(clean_series.index)
    aligned = pd.concat(
        [
            clean_series.rename("observed"),
            predicted_mean.rename("fitted"),
        ],
        axis=1,
    ).dropna()

    forecast = fitted.get_forecast(steps=payload.horizon)
    forecast_index = forecast.predicted_mean.index
    confidence = forecast.conf_int(alpha=0.05)
    lower = confidence.iloc[:, 0]
    upper = confidence.iloc[:, 1]

    fitted_frame = aligned.rename_axis("bucket").reset_index()
    forecast_frame = pd.DataFrame(
        {
            "bucket": forecast_index,
            "forecast": forecast.predicted_mean.to_numpy(dtype=float),
            "lower": lower.to_numpy(dtype=float),
            "upper": upper.to_numpy(dtype=float),
        }
    )

    residuals = aligned["observed"] - aligned["fitted"]
    rmse = float(np.sqrt(np.mean(np.square(residuals)))) if not aligned.empty else 0.0
    mae = float(np.mean(np.abs(residuals))) if not aligned.empty else 0.0
    stats = {
        "aic": float(getattr(fitted, "aic", np.nan)) if np.isfinite(getattr(fitted, "aic", np.nan)) else None,
        "bic": float(getattr(fitted, "bic", np.nan)) if np.isfinite(getattr(fitted, "bic", np.nan)) else None,
        "rmse": rmse,
        "mae": mae,
    }
    return fitted_frame, forecast_frame, stats


def _load_statsmodels(error_cls: type[Exception]) -> tuple[Any, Any]:
    try:
        from statsmodels.tsa.arima.model import ARIMA
        from statsmodels.tsa.statespace.sarimax import SARIMAX
    except ModuleNotFoundError as exc:
        raise error_cls(
            "Advanced Analytics requiere statsmodels en el entorno del backend. "
            "Instálalo en apps/backend/.venv antes de usar ARIMA o SARIMA."
        ) from exc

    return ARIMA, SARIMAX
