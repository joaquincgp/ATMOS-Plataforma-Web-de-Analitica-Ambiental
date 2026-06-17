from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260617_0002"
down_revision = "20260617_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing_columns = _existing_user_columns()
    for name, column_type in (
        ("institution", sa.String(length=255)),
        ("job_title", sa.String(length=255)),
        ("department", sa.String(length=255)),
        ("phone", sa.String(length=64)),
        ("country", sa.String(length=128)),
    ):
        if name not in existing_columns:
            op.add_column("users", sa.Column(name, column_type, nullable=True))


def downgrade() -> None:
    existing_columns = _existing_user_columns()
    for name in ("country", "phone", "department", "job_title", "institution"):
        if name in existing_columns:
            op.drop_column("users", name)


def _existing_user_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("users")}
