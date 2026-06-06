from __future__ import annotations

import plotly.graph_objects as go

from app.services.plotly_theme import apply_atmos_plotly_theme


def test_apply_atmos_plotly_theme_sets_shared_layout() -> None:
    figure = go.Figure(data=[go.Scatter(x=[1, 2], y=[3, 4])])

    themed = apply_atmos_plotly_theme(figure, title="Air quality", height=420, showlegend=False)

    assert themed is figure
    assert themed.layout.template.layout.paper_bgcolor == "white"
    assert themed.layout.paper_bgcolor == "white"
    assert themed.layout.plot_bgcolor == "white"
    assert themed.layout.height == 420
    assert themed.layout.showlegend is False
    assert themed.layout.title.text == "Air quality"


def test_apply_atmos_plotly_theme_allows_custom_margin_and_legend_position() -> None:
    margin = {"l": 10, "r": 20, "t": 30, "b": 40}
    figure = go.Figure()

    themed = apply_atmos_plotly_theme(figure, margin=margin, legend_y=0.8)

    assert themed.layout.margin.l == 10
    assert themed.layout.margin.r == 20
    assert themed.layout.margin.t == 30
    assert themed.layout.margin.b == 40
    assert themed.layout.legend.y == 0.8
