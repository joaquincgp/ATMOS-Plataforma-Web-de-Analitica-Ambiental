from __future__ import annotations

import os
from getpass import getpass

from sqlalchemy import select

from app.db.init_db import init_db
from app.db.session import SessionLocal
from app.models.user import User
from app.schemas.auth import UserRole, UserStatus
from app.services.auth_service import hash_password


def main() -> None:
    init_db()
    email = os.getenv("ATMOS_ADMIN_EMAIL", "carmen.toledo@udla.edu.ec").strip().lower()
    full_name = os.getenv("ATMOS_ADMIN_NAME", "ATMOS Admin").strip()
    password = os.getenv("ATMOS_ADMIN_PASSWORD")
    if not password:
        password = getpass("ATMOS_ADMIN_PASSWORD: ")

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                full_name=full_name,
                password_hash=hash_password(password),
                role=UserRole.admin.value,
                status=UserStatus.active.value,
                is_active=True,
                is_verified=True,
            )
            db.add(user)
            action = "created"
        else:
            user.full_name = user.full_name or full_name
            user.password_hash = hash_password(password)
            user.role = UserRole.admin.value
            user.status = UserStatus.active.value
            user.is_active = True
            user.is_verified = True
            action = "updated"
        db.commit()
        print(f"Admin user {action}: {email}")


if __name__ == "__main__":
    main()
