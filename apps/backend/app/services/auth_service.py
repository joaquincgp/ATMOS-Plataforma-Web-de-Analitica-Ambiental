from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta
from typing import Any

import bcrypt
from jose import JWTError, jwt
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.password_reset_token import PasswordResetToken
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.auth import (
    AdminCreateUserRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    MessageResponse,
    RefreshTokenRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SessionResponse,
    TokenPairResponse,
    UpdateProfileRequest,
    UserResponse,
    UserRole,
    UserStatus,
)

logger = logging.getLogger(__name__)
settings = get_settings()

PASSWORD_HASH_PREFIX = "bcrypt_sha256"


class AuthError(Exception):
    pass


def _utcnow() -> datetime:
    return datetime.utcnow()


def _token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _user_response(user: User) -> UserResponse:
    return UserResponse.model_validate(user)


def hash_password(password: str) -> str:
    password_normalized = password.strip()
    if len(password_normalized) < 8:
        raise AuthError("Password must be at least 8 characters.")
    if len(password_normalized) > 128:
        raise AuthError("Password must be at most 128 characters.")

    # Pre-hash with SHA-256 to safely support arbitrary-length Unicode passwords.
    password_bytes = hashlib.sha256(password_normalized.encode("utf-8")).hexdigest().encode("utf-8")
    try:
        bcrypt_hash = bcrypt.hashpw(password_bytes, bcrypt.gensalt(rounds=12)).decode("utf-8")
        return f"{PASSWORD_HASH_PREFIX}${bcrypt_hash}"
    except ValueError as exc:
        raise AuthError("Password format is invalid or unsupported.") from exc
    except Exception as exc:
        raise AuthError("Could not securely process the password due to hashing backend error.") from exc


def verify_password(password: str, password_hash: str) -> bool:
    try:
        candidate = password.encode("utf-8")
        if password_hash.startswith(f"{PASSWORD_HASH_PREFIX}$"):
            stored_hash = password_hash.split("$", 1)[1].encode("utf-8")
            candidate = hashlib.sha256(password.encode("utf-8")).hexdigest().encode("utf-8")
            return bcrypt.checkpw(candidate, stored_hash)

        # Legacy bcrypt hashes (without SHA-256 pre-hash) for backward compatibility.
        if password_hash.startswith("$2a$") or password_hash.startswith("$2b$") or password_hash.startswith("$2y$"):
            return bcrypt.checkpw(candidate, password_hash.encode("utf-8"))

        return False
    except Exception:
        return False


def _build_access_token_payload(user: User, *, expires_at: datetime) -> dict[str, Any]:
    return {
        "sub": user.id,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "type": "access",
        "exp": expires_at,
        "iat": _utcnow(),
    }


def create_access_token(user: User) -> str:
    expires_at = _utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    payload = _build_access_token_payload(user, expires_at=expires_at)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise AuthError("Invalid or expired token.") from exc

    token_type = payload.get("type")
    if token_type != "access":
        raise AuthError("Invalid token type.")
    if not payload.get("sub"):
        raise AuthError("Invalid token subject.")

    return payload


def get_user_from_access_token(db: Session, token: str) -> User:
    payload = decode_access_token(token)
    user_id = str(payload["sub"])
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None or not user.is_active:
        raise AuthError("User not found or inactive.")
    if user.status == UserStatus.suspended.value:
        raise AuthError("User suspended.")
    return user


def _create_refresh_token(
    db: Session,
    user: User,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> str:
    raw_refresh_token = secrets.token_urlsafe(48)
    token_row = RefreshToken(
        user_id=user.id,
        token_hash=_token_hash(raw_refresh_token),
        user_agent=user_agent,
        ip_address=ip_address,
        expires_at=_utcnow() + timedelta(days=settings.refresh_token_expire_days),
    )
    db.add(token_row)
    return raw_refresh_token


def _build_token_pair_response(user: User, *, refresh_token: str) -> TokenPairResponse:
    return TokenPairResponse(
        access_token=create_access_token(user),
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60,
        refresh_expires_in=settings.refresh_token_expire_days * 24 * 60 * 60,
        user=_user_response(user),
    )


def register_user(db: Session, payload: RegisterRequest) -> UserResponse:
    existing = db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing is not None:
        raise AuthError("A user with this email already exists.")

    user = User(
        email=payload.email.lower(),
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=UserRole.researcher.value,
        status=UserStatus.pending_validation.value,
        is_active=True,
        is_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_response(user)


def admin_create_user(db: Session, payload: AdminCreateUserRequest) -> UserResponse:
    existing = db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing is not None:
        raise AuthError("A user with this email already exists.")

    is_verified = payload.status == UserStatus.active
    user = User(
        email=payload.email.lower(),
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=payload.role.value,
        status=payload.status.value,
        is_active=payload.status != UserStatus.suspended,
        is_verified=is_verified,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_response(user)


def login_user(
    db: Session,
    payload: LoginRequest,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> TokenPairResponse:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise AuthError("Invalid credentials.")

    if not user.is_active or user.status == UserStatus.suspended.value:
        raise AuthError("User account is inactive.")

    user.last_login_at = _utcnow()
    refresh_token = _create_refresh_token(db, user, user_agent=user_agent, ip_address=ip_address)
    db.commit()
    db.refresh(user)
    return _build_token_pair_response(user, refresh_token=refresh_token)


def refresh_access_token(
    db: Session,
    payload: RefreshTokenRequest,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> TokenPairResponse:
    now = _utcnow()
    hashed_token = _token_hash(payload.refresh_token)
    refresh_row = db.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == hashed_token,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > now,
        )
    )

    if refresh_row is None:
        raise AuthError("Refresh token is invalid or expired.")

    user = db.scalar(select(User).where(User.id == refresh_row.user_id))
    if user is None or not user.is_active or user.status == UserStatus.suspended.value:
        raise AuthError("User account is inactive.")

    refresh_row.revoked_at = now
    new_refresh_token = _create_refresh_token(db, user, user_agent=user_agent, ip_address=ip_address)
    db.commit()

    return _build_token_pair_response(user, refresh_token=new_refresh_token)


def logout_user(db: Session, refresh_token: str) -> MessageResponse:
    hashed = _token_hash(refresh_token)
    now = _utcnow()
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == hashed, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.commit()
    return MessageResponse(message="Logged out successfully.")


def validate_session(db: Session, token: str) -> SessionResponse:
    user = get_user_from_access_token(db, token)
    return SessionResponse(authenticated=True, user=_user_response(user))


def forgot_password(db: Session, payload: ForgotPasswordRequest) -> ForgotPasswordResponse:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    generic_response = ForgotPasswordResponse(
        message="If the account exists, a reset link has been sent.",
        debug_reset_token=None,
    )

    if user is None or not user.is_active:
        return generic_response

    now = _utcnow()
    db.execute(
        delete(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        )
    )

    raw_token = secrets.token_urlsafe(40)
    reset_row = PasswordResetToken(
        user_id=user.id,
        token_hash=_token_hash(raw_token),
        expires_at=now + timedelta(minutes=settings.password_reset_token_expire_minutes),
    )
    db.add(reset_row)
    db.commit()

    # Simulated email integration (Azure Communication Services/SendGrid SMTP placeholder).
    logger.info("Password reset requested for %s", user.email)

    if settings.environment.lower() != "production":
        generic_response.debug_reset_token = raw_token

    return generic_response


def reset_password(db: Session, payload: ResetPasswordRequest) -> MessageResponse:
    now = _utcnow()
    token_hash = _token_hash(payload.token)
    reset_row = db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
    )
    if reset_row is None:
        raise AuthError("Reset token is invalid or expired.")

    user = db.scalar(select(User).where(User.id == reset_row.user_id))
    if user is None or not user.is_active:
        raise AuthError("User account is not available.")

    user.password_hash = hash_password(payload.new_password)
    user.updated_at = now
    user.is_verified = True
    if user.status == UserStatus.pending_validation.value:
        user.status = UserStatus.active.value

    reset_row.used_at = now
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.commit()

    return MessageResponse(message="Password updated successfully.")


def update_profile(db: Session, user: User, payload: UpdateProfileRequest) -> UserResponse:
    user.full_name = payload.full_name
    user.institution = payload.institution
    user.job_title = payload.job_title
    user.department = payload.department
    user.phone = payload.phone
    user.country = payload.country
    user.updated_at = _utcnow()
    db.commit()
    db.refresh(user)
    return _user_response(user)
