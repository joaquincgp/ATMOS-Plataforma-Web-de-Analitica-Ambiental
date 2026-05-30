# Unit tests cover remaining shared EDA helper branches.
# pylint: disable=protected-access

from datetime import UTC, datetime

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from app.schemas.eda import EdaPlotRequest
from app.services.eda.common import EdaSharedMixin


class SharedHelpers(EdaSharedMixin):
    pass


def test_secondary_empty_and_serialize_helpers_return_plotly_payloads() -> None:
    helper = SharedHelpers()
    figure = go.Figure(go.Scatter(x=[1], y=[2]))

    secondary = helper._secondary("main", "Main", None, figure)
    empty = helper._empty_figure("No data")

    assert secondary.key == "main"
    assert secondary.figure_json["data"]
    assert empty.layout.annotations[0].text == "No data"


def test_time_navigation_updates_last_subplot_axis_and_unsupported_sections() -> None:
    helper = SharedHelpers()
    figure = make_subplots(rows=2, cols=1)
    figure.add_trace(go.Scatter(x=[datetime(2025, 1, 1)], y=[1]), row=1, col=1)
    figure.add_trace(go.Scatter(x=[datetime(2025, 1, 2)], y=[2]), row=2, col=1)
    payload = EdaPlotRequest(
        section="trend",
        view_from=datetime(2025, 1, 1, tzinfo=UTC),
        view_to=datetime(2025, 1, 3, tzinfo=UTC),
    )

    updated = helper._apply_time_navigation(figure, payload)

    assert updated.layout.xaxis2.rangeslider.visible is True
    assert helper._navigation_window(EdaPlotRequest(section="summary")) is None
    assert helper._supports_time_navigation(EdaPlotRequest(section="summary")) is False


def test_navigation_no_axis_empty_and_visible_fallback_paths() -> None:
    helper = SharedHelpers()
    figure = go.Figure()
    payload = EdaPlotRequest(
        section="rolling",
        view_from=datetime(2025, 1, 3, tzinfo=UTC),
        view_to=datetime(2025, 1, 3, tzinfo=UTC),
        rolling_window=0,
    )
    frame = pd.DataFrame(
        {
            "observed_at": pd.to_datetime(["2025-01-03", "2025-01-20"], utc=True),
            "value": [1, 2],
        }
    )
    out_of_range = EdaPlotRequest(
        section="rolling",
        view_from=datetime(2025, 1, 10, tzinfo=UTC),
        view_to=datetime(2025, 1, 10, tzinfo=UTC),
        rolling_window=0,
    )

    updated = helper._apply_time_navigation(figure, payload)
    clipped = helper._clip_time_frame(frame, time_column="observed_at", payload=payload)
    empty_fallback = helper._clip_time_frame(frame, time_column="observed_at", payload=out_of_range)

    assert updated.layout.xaxis.rangeslider.visible is True
    assert clipped["value"].tolist() == [1]
    assert empty_fallback.empty


def test_shift_timestamp_and_navigation_lookbacks_cover_all_modes() -> None:
    helper = SharedHelpers()
    timestamp = pd.Timestamp("2025-01-01T00:00:00Z")

    assert helper._shift_timestamp(timestamp, "year", 1).year == 2026
    assert helper._shift_timestamp(timestamp, "quarter", 1).month == 4
    assert helper._shift_timestamp(timestamp, "month", 1).month == 2
    assert helper._shift_timestamp(timestamp, "week", 1).day == 8
    assert helper._shift_timestamp(timestamp, "hour", 2).hour == 2
    assert helper._shift_timestamp(timestamp, "day", 0) == timestamp
    assert helper._navigation_lookback_steps(EdaPlotRequest(section="changepoints", changepoint_window=5)) == 5
    assert helper._navigation_lookahead_steps(EdaPlotRequest(section="forecast", forecast_horizon=4)) == 4


def test_math_helpers_cover_degenerate_inputs() -> None:
    helper = SharedHelpers()

    regression = helper._regression_line(np.array([1.0, 1.0, 1.0]), np.array([2.0, 2.0, 2.0]))
    short_polynomial = helper._polynomial_line(np.array([1.0]), np.array([2.0]), order=2)
    empty_polynomial = helper._polynomial_line(np.array([]), np.array([]), order=2)
    single_grid, single_density = helper._kde_curve(np.array([5.0]), cumulative=False, normalize_density=False)
    empty_grid, empty_density = helper._kde_curve(np.array([np.nan]), cumulative=False, normalize_density=True)

    assert np.array_equal(regression["lower"], regression["upper"])
    assert short_polynomial["y"].size == 100
    assert empty_polynomial["x"].size == 0
    assert single_grid.tolist() == [5.0]
    assert single_density.tolist() == [1.0]
    assert empty_grid.size == 0
    assert empty_density.size == 0
    assert helper._fit_linear(np.array([]))["predicted"].size == 0
    assert helper._linear_regression_terms(np.array([]), np.array([]))[-1].size == 0
    assert helper._fit_quadratic(np.array([])).size == 0
    assert helper._fit_quadratic(np.array([1.0, 2.0])).tolist() == [1.0, 2.0]
    assert helper._autocorrelation_at_lag(np.array([2.0, 2.0, 2.0]), 1) == 0.0


def test_column_helpers_and_clip_return_original_for_missing_context() -> None:
    helper = SharedHelpers()
    frame = pd.DataFrame({"numeric": ["1", "2", "3"], "category": ["a", "b", "c"]})
    clipped = helper._clip_time_frame(frame, time_column="missing", payload=EdaPlotRequest(section="rolling"))

    assert helper._numeric_columns(frame) == ["numeric"]
    assert helper._categorical_columns(frame) == ["category"]
    assert clipped is frame
    assert helper._coerce_datetime_series(pd.Series(["2025-01-01"])).iloc[0] == pd.Timestamp("2025-01-01T00:00:00Z")
