from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa

from alembic import op

revision = "20260617_0001"
down_revision = None
branch_labels = None
depends_on = None


APP_CONFIG_DEFAULTS = (
    ("analytics.max_statsmodels_points", "5000", "Limite serie ARIMA/SARIMA"),
    ("analytics.max_prophet_points", "20000", "Limite serie Prophet"),
    ("analytics.max_figure_points", "4000", "Max puntos renderizados en grafico"),
    ("analytics.min_series_length_sarima", "12", "Minimo puntos para SARIMA"),
    ("analytics.min_series_length_arima", "8", "Minimo puntos para ARIMA"),
    ("analytics.min_series_length_prophet", "3", "Minimo puntos para Prophet"),
    ("analytics.default_query_limit", "5000", "Filas por defecto en query"),
    ("analytics.source_list_limit", "300", "Max fuentes devueltas en filtros"),
    ("workspace.default_rolling_window", "0", "Ventana rolling"),
    ("workspace.default_decomposition_window", "21", "Ventana STL"),
    ("workspace.default_forecast_horizon", "30", "Horizonte de pronostico (periodos)"),
    ("workspace.default_changepoint_window", "7", "Ventana changepoints"),
    ("workspace.default_changepoint_sensitivity", "2", "Sensibilidad changepoints"),
    ("workspace.default_histogram_bins", "32", "Bins histograma"),
    ("workspace.default_confidence_level", "0.95", "Nivel IC (0-1)"),
    ("workspace.default_marker_opacity", "0.78", "Opacidad marcadores scatter"),
    ("workspace.default_marker_size", "7", "Tamano marcadores scatter"),
    ("workspace.default_facet_columns", "2", "Columnas en facet multi-variable"),
)


def upgrade() -> None:
    app_config = op.create_table(
        "app_config",
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value", sa.String(length=64), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    now = datetime.utcnow()
    op.bulk_insert(
        app_config,
        [
            {"key": key, "value": value, "description": description, "updated_at": now}
            for key, value, description in APP_CONFIG_DEFAULTS
        ],
    )


def downgrade() -> None:
    op.drop_table("app_config")
