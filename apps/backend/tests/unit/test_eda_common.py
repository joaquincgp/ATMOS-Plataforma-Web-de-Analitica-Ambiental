# Unit tests intentionally exercise internal numerical helpers.
# pylint: disable=protected-access

from datetime import UTC, datetime

import numpy as np
import pandas as pd

from app.schemas.eda import EdaPlotRequest
from app.services.eda.common import EdaSharedMixin


class SharedHelpers(EdaSharedMixin):
    pass


def test_aggregate_values_supports_expected_modes_and_empty_series() -> None:
    helper = SharedHelpers()
    series = pd.Series([1, 2, 3, None])

    assert helper._aggregate_values(series, "mean") == 2.0
    assert helper._aggregate_values(series, "median") == 2.0
    assert helper._aggregate_values(series, "sum") == 6.0
    assert helper._aggregate_values(series, "min") == 1.0
    assert helper._aggregate_values(series, "max") == 3.0
    assert round(helper._aggregate_values(series, "std"), 6) == round(float(np.std([1, 2, 3])), 6)
    assert helper._aggregate_values(pd.Series(["bad"]), "mean") == 0.0


def test_bucket_helpers_cover_granularities_and_increment_paths() -> None:
    helper = SharedHelpers()
    timestamp = pd.Timestamp("2025-01-15T03:00:00Z")

    assert helper._bucket_key(timestamp, "year") == "2025"
    assert helper._bucket_key(timestamp, "quarter") == "2025-Q1"
    assert helper._bucket_key(timestamp, "month") == "2025-01"
    assert helper._bucket_key(timestamp, "week").startswith("2025-W")
    assert helper._bucket_key(timestamp, "hour") == "2025-01-15 03:00"
    assert helper._bucket_key(timestamp, "day") == "2025-01-15"

    assert helper._increment_bucket("2025", "year", 1) == "2026"
    assert helper._increment_bucket("2025-Q4", "quarter", 1) == "2026-Q1"
    assert helper._increment_bucket("2025-01", "month", 1) == "2025-02"
    assert helper._increment_bucket("2025-W01", "week", 1) == "2025-W02"
    assert helper._increment_bucket("2025-01-01 23:00", "hour", 1) == "2025-01-02 00:00"
    assert helper._increment_bucket("2025-01-01", "day", 1) == "2025-01-02"


def test_time_navigation_window_adds_context_and_sorts_inverted_ranges() -> None:
    helper = SharedHelpers()
    payload = EdaPlotRequest(
        section="forecast",
        view_from=datetime(2025, 1, 10, tzinfo=UTC),
        view_to=datetime(2025, 1, 1, tzinfo=UTC),
        granularity="day",
        decomposition_window=3,
        forecast_horizon=2,
    )

    start, end = helper._navigation_window(payload)

    assert start == pd.Timestamp("2024-12-29T00:00:00Z")
    assert end == pd.Timestamp("2025-01-12T00:00:00Z")


def test_clip_time_frame_uses_buffered_window_and_visible_fallback() -> None:
    helper = SharedHelpers()
    frame = pd.DataFrame(
        {
            "observed_at": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-20"], utc=True),
            "value": [1, 2, 3],
        }
    )
    payload = EdaPlotRequest(
        section="rolling",
        view_from=datetime(2025, 1, 2, tzinfo=UTC),
        view_to=datetime(2025, 1, 2, tzinfo=UTC),
        rolling_window=0,
    )

    clipped = helper._clip_time_frame(frame, time_column="observed_at", payload=payload)

    assert clipped["value"].tolist() == [1, 2]


def test_point_budget_numeric_classification_and_safe_stats() -> None:
    helper = SharedHelpers()
    frame = pd.DataFrame({"value": range(10)})

    assert helper._apply_point_budget(frame, None) is frame
    assert helper._apply_point_budget(frame, 3)["value"].tolist() == [0, 4, 9]
    assert helper._is_numeric(pd.Series(["1", "2", "bad"])) is True
    assert helper._is_categorical(pd.Series(["a", "b", "c"])) is True
    assert helper._safe_mean(np.array([])) == 0.0
    assert helper._safe_std(np.array([])) == 0.0


def test_regression_polynomial_kde_and_autocorrelation_helpers() -> None:
    helper = SharedHelpers()
    values = np.array([1.0, 2.0, 3.0, 4.0])

    linear = helper._fit_linear(values)
    assert linear["slope"] > 0
    assert linear["r2"] == 1.0

    quadratic = helper._fit_quadratic(values)
    assert len(quadratic) == 4

    grid, density = helper._kde_curve(values, cumulative=True, normalize_density=True)
    assert len(grid) == 200
    assert density[-1] == 1.0

    assert helper._autocorrelation_at_lag(values, 0) == 1.0
    assert helper._autocorrelation_at_lag(values, 10) == 0.0
    assert helper._seasonal_period("hour") == 24
    assert helper._seasonal_period("day") == 7
