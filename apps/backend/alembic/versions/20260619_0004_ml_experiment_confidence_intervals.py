from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260619_0004"
down_revision = "20260617_0003"
branch_labels = None
depends_on = None

_TABLE_NAME = "ml_experiment_runs"
_NEW_COLUMNS = (
    "final_rmse_ci_low",
    "final_rmse_ci_high",
    "r_squared_ci_low",
    "r_squared_ci_high",
)


def upgrade() -> None:
    # ml_experiment_runs is otherwise managed by Base.metadata.create_all() at
    # app startup, not by Alembic; on a fresh database the table (already
    # including these columns, since they're in the current model) won't
    # exist yet at migration time, so skip rather than fail.
    if not _table_exists():
        return
    existing_columns = _existing_columns()
    for name in _NEW_COLUMNS:
        if name not in existing_columns:
            op.add_column(_TABLE_NAME, sa.Column(name, sa.Float(), nullable=True))


def downgrade() -> None:
    if not _table_exists():
        return
    existing_columns = _existing_columns()
    for name in _NEW_COLUMNS:
        if name in existing_columns:
            op.drop_column(_TABLE_NAME, name)


def _table_exists() -> bool:
    inspector = sa.inspect(op.get_bind())
    return _TABLE_NAME in inspector.get_table_names()


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(_TABLE_NAME)}
