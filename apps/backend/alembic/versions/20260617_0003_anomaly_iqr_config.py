from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa

from alembic import op

revision = "20260617_0003"
down_revision = "20260617_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    exists = op.get_bind().execute(
        sa.text("SELECT 1 FROM app_config WHERE key = :key"),
        {"key": "analytics.anomaly_iqr_multiplier"},
    ).first()
    if exists:
        return

    app_config = sa.table(
        "app_config",
        sa.column("key", sa.String),
        sa.column("value", sa.String),
        sa.column("description", sa.String),
        sa.column("updated_at", sa.DateTime),
    )
    op.bulk_insert(
        app_config,
        [
            {
                "key": "analytics.anomaly_iqr_multiplier",
                "value": "1.5",
                "description": "Multiplicador IQR para detectar valores atipicos",
                "updated_at": datetime.utcnow(),
            }
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_config WHERE key = 'analytics.anomaly_iqr_multiplier'")
