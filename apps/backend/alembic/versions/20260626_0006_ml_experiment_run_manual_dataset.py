from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260626_0006"
down_revision = "20260626_0005"
branch_labels = None
depends_on = None

_TABLE_NAME = "ml_experiment_runs"


def upgrade() -> None:
    if not _table_exists():
        return
    existing_columns = _existing_columns()
    if "manual_dataset_id" not in existing_columns:
        op.add_column(_TABLE_NAME, sa.Column("manual_dataset_id", sa.String(length=36), nullable=True))
        op.create_index(
            "ix_ml_experiment_runs_manual_dataset_id", _TABLE_NAME, ["manual_dataset_id"], unique=False
        )


def downgrade() -> None:
    if not _table_exists():
        return
    existing_columns = _existing_columns()
    if "manual_dataset_id" in existing_columns:
        op.drop_index("ix_ml_experiment_runs_manual_dataset_id", table_name=_TABLE_NAME)
        op.drop_column(_TABLE_NAME, "manual_dataset_id")


def _table_exists() -> bool:
    inspector = sa.inspect(op.get_bind())
    return _TABLE_NAME in inspector.get_table_names()


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(_TABLE_NAME)}
