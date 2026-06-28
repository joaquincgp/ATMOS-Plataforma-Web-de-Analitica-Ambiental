from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260626_0005"
down_revision = "20260619_0004"
branch_labels = None
depends_on = None

_TABLE_NAME = "manual_datasets"


def upgrade() -> None:
    existing_columns = _existing_columns()
    if "created_for" not in existing_columns:
        op.add_column(_TABLE_NAME, sa.Column("created_for", sa.String(length=32), nullable=True))
        op.create_index(
            "ix_manual_datasets_created_for", _TABLE_NAME, ["created_for"], unique=False
        )
    if "source_metadata" not in existing_columns:
        op.add_column(_TABLE_NAME, sa.Column("source_metadata", sa.JSON(), nullable=True))


def downgrade() -> None:
    existing_columns = _existing_columns()
    if "source_metadata" in existing_columns:
        op.drop_column(_TABLE_NAME, "source_metadata")
    if "created_for" in existing_columns:
        op.drop_index("ix_manual_datasets_created_for", table_name=_TABLE_NAME)
        op.drop_column(_TABLE_NAME, "created_for")


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(_TABLE_NAME)}
