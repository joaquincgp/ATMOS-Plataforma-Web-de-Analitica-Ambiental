from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.schemas.advanced_analytics import AdvancedAnalyticsRequest
from app.services.advanced_analytics_service import AdvancedAnalyticsError, AdvancedAnalyticsService


def test_aggregate_series_resamples_and_interpolates() -> None:
    service = AdvancedAnalyticsService(db=None, user=None)  # type: ignore[arg-type]
    observed_at = pd.Series(pd.to_datetime(["2025-01-01T00:00:00Z", "2025-01-03T00:00:00Z"], utc=True))
    values = pd.Series([10.0, 14.0])

    result = service._aggregate_series(observed_at, values, "day")

    assert list(result.index.astype(str)) == [
        "2025-01-01 00:00:00+00:00",
        "2025-01-02 00:00:00+00:00",
        "2025-01-03 00:00:00+00:00",
    ]
    assert float(result.iloc[1]) == 12.0


def test_fit_model_builds_forecast_frame() -> None:
    pytest.importorskip("statsmodels")
    service = AdvancedAnalyticsService(db=None, user=None)  # type: ignore[arg-type]
    index = pd.date_range("2024-01-01", periods=36, freq="D", tz="UTC")
    values = pd.Series(np.linspace(10.0, 20.0, num=36), index=index)
    payload = AdvancedAnalyticsRequest(model="arima", order=[1, 1, 1], horizon=5)

    fitted_frame, forecast_frame, stats = service._fit_model(values, payload)

    assert not fitted_frame.empty
    assert len(forecast_frame) == 5
    assert "rmse" in stats


def test_fit_model_requires_seasonal_order_for_sarima() -> None:
    pytest.importorskip("statsmodels")
    service = AdvancedAnalyticsService(db=None, user=None)  # type: ignore[arg-type]
    index = pd.date_range("2024-01-01", periods=24, freq="D", tz="UTC")
    values = pd.Series(np.linspace(5.0, 9.0, num=24), index=index)
    payload = AdvancedAnalyticsRequest(model="sarima", order=[1, 1, 1], horizon=3)

    try:
        service._fit_model(values, payload)
    except AdvancedAnalyticsError as exc:
        assert "seasonal_order" in str(exc)
    else:
        raise AssertionError("Expected AdvancedAnalyticsError when seasonal_order is missing.")


def test_fit_model_builds_prophet_forecast_frame() -> None:
    pytest.importorskip("prophet")
    service = AdvancedAnalyticsService(db=None, user=None)  # type: ignore[arg-type]
    index = pd.date_range("2024-01-01", periods=36, freq="D", tz="UTC")
    values = pd.Series(np.linspace(10.0, 20.0, num=36), index=index)
    payload = AdvancedAnalyticsRequest(model="prophet", horizon=5)

    fitted_frame, forecast_frame, stats = service._fit_model(values, payload)

    assert not fitted_frame.empty
    assert len(forecast_frame) == 5
    assert "rmse" in stats


def test_validate_model_budget_rejects_oversized_statsmodels_series() -> None:
    service = AdvancedAnalyticsService(db=None, user=None)  # type: ignore[arg-type]
    index = pd.date_range("2024-01-01", periods=6001, freq="D", tz="UTC")
    values = pd.Series(np.linspace(10.0, 20.0, num=6001), index=index)
    payload = AdvancedAnalyticsRequest(model="arima", order=[1, 1, 1], horizon=5)

    with pytest.raises(AdvancedAnalyticsError, match="demasiado grande"):
        service._validate_model_budget(values, payload)


def test_apply_plot_budget_decimates_large_frames() -> None:
    service = AdvancedAnalyticsService(db=None, user=None)  # type: ignore[arg-type]
    frame = pd.DataFrame(
        {
            "bucket": pd.date_range("2024-01-01", periods=5005, freq="D", tz="UTC"),
            "value": np.linspace(1.0, 2.0, num=5005),
        }
    )

    result = service._apply_plot_budget(frame)

    assert len(result) < len(frame)
    assert result.iloc[-1]["bucket"] == frame.iloc[-1]["bucket"]


def test_build_figure_accepts_series_without_reset_index_names_support() -> None:
    service = AdvancedAnalyticsService(db=None, user=None)  # type: ignore[arg-type]
    observed = pd.Series(
        [10.0, 12.0, 14.0],
        index=pd.date_range("2024-01-01", periods=3, freq="D", tz="UTC"),
    )
    fitted_frame = pd.DataFrame(
        {
            "bucket": pd.date_range("2024-01-01", periods=3, freq="D", tz="UTC"),
            "fitted": [10.1, 11.9, 14.1],
        }
    )
    forecast_frame = pd.DataFrame(
        {
            "bucket": pd.date_range("2024-01-04", periods=2, freq="D", tz="UTC"),
            "forecast": [15.0, 16.0],
            "lower": [14.5, 15.5],
            "upper": [15.5, 16.5],
        }
    )

    figure = service._build_figure(observed, fitted_frame, forecast_frame, "PM25", "arima")

    assert len(figure.data) == 5
