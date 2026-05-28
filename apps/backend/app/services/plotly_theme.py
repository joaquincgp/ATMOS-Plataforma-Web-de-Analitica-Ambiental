from __future__ import annotations

from typing import Any

import plotly.graph_objects as go

ATMOS_FONT = "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
ATMOS_TITLE_COLOR = "#24384D"
ATMOS_TEXT_COLOR = "#1F2937"
ATMOS_GRID_COLOR = "#E5EAF0"
ATMOS_AXIS_COLOR = "#CBD5E1"


def apply_atmos_plotly_theme(
    figure: go.Figure,
    *,
    title: str | None = None,
    height: int | None = None,
    margin: dict[str, int] | None = None,
    showlegend: bool | None = None,
    legend_y: float | None = None,
) -> go.Figure:
    """Apply the shared ATMOS analytical chart style to Plotly figures."""
    layout_update: dict[str, Any] = {
        "template": "plotly_white",
        "paper_bgcolor": "white",
        "plot_bgcolor": "white",
        "margin": margin or {"l": 68, "r": 42, "t": 104 if title else 48, "b": 64},
        "hovermode": "closest",
        "legend": {
            "orientation": "h",
            "yanchor": "bottom",
            "y": legend_y if legend_y is not None else (1.11 if title else 1.04),
            "xanchor": "left",
            "x": 0,
            "font": {"size": 11},
            "itemsizing": "constant",
        },
        "font": {"family": ATMOS_FONT, "size": 12, "color": ATMOS_TEXT_COLOR},
        "title_font": {"family": ATMOS_FONT, "size": 15, "color": ATMOS_TITLE_COLOR},
    }
    if height is not None:
        layout_update["height"] = height
    if showlegend is not None:
        layout_update["showlegend"] = showlegend

    figure.update_layout(**layout_update)
    figure.update_xaxes(
        showgrid=True,
        gridcolor=ATMOS_GRID_COLOR,
        zeroline=False,
        linecolor=ATMOS_AXIS_COLOR,
        ticks="outside",
        automargin=True,
    )
    figure.update_yaxes(
        showgrid=True,
        gridcolor=ATMOS_GRID_COLOR,
        zeroline=False,
        linecolor=ATMOS_AXIS_COLOR,
        ticks="outside",
        automargin=True,
    )
    if title:
        figure.update_layout(
            title={
                "text": title,
                "x": 0.01,
                "y": 0.985,
                "xanchor": "left",
                "yanchor": "top",
                "font": {"size": 15, "color": ATMOS_TITLE_COLOR},
                "pad": {"b": 18},
            }
        )
    return figure
