from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import bcrypt
from jose import JWTError, jwt
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.email_verification_token import EmailVerificationToken
from app.models.password_reset_token import PasswordResetToken
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.auth import (
    AdminCreateUserRequest,
    AdminUpdateUserRequest,
    AdminUserResponse,
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
from app.services.email_service import EmailDeliveryError, send_password_reset_email, send_verification_email

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


def _is_allowed_email_domain(email: str) -> bool:
    normalized = email.strip().lower()
    if "@" not in normalized:
        return False
    domain = normalized.rsplit("@", 1)[1]
    return domain in settings.allowed_email_domains_list


def _require_allowed_email(email: str) -> str:
    normalized = email.strip().lower()
    if not _is_allowed_email_domain(normalized):
        allowed = ", ".join(f"@{domain}" for domain in settings.allowed_email_domains_list)
        raise AuthError(f"Only institutional email addresses are allowed ({allowed}).")
    return normalized


def _admin_user_response(user: User, workspace_count: int = 0) -> AdminUserResponse:
    response = AdminUserResponse.model_validate(user)
    response.workspace_count = workspace_count
    return response


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


def _build_frontend_url(path: str, **params: str) -> str:
    base = settings.frontend_base_url.rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    query = urlencode({key: value for key, value in params.items() if value})
    return f"{url}?{query}" if query else url


def _create_email_verification_token(db: Session, user: User) -> str:
    db.execute(
        delete(EmailVerificationToken).where(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.used_at.is_(None),
        )
    )
    raw_token = secrets.token_urlsafe(40)
    db.add(
        EmailVerificationToken(
            user_id=user.id,
            token_hash=_token_hash(raw_token),
            expires_at=_utcnow() + timedelta(minutes=settings.email_verification_token_expire_minutes),
        )
    )
    return raw_token


def _send_verification_email_for_user(db: Session, user: User) -> str:
    raw_token = _create_email_verification_token(db, user)
    verification_url = _build_frontend_url("verify-email", token=raw_token)
    send_verification_email(to_email=user.email, full_name=user.full_name, verification_url=verification_url)
    return raw_token


def register_user(db: Session, payload: RegisterRequest) -> UserResponse:
    email = _require_allowed_email(payload.email)
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise AuthError("A user with this email already exists.")

    user = User(
        email=email,
        full_name=payload.full_name,
        institution=payload.institution,
        password_hash=hash_password(payload.password),
        role=UserRole.researcher.value,
        status=UserStatus.pending_validation.value,
        is_active=True,
        is_verified=False,
    )
    db.add(user)
    db.flush()
    try:
        _send_verification_email_for_user(db, user)
    except EmailDeliveryError as exc:
        raise AuthError("Could not send verification email. Check email service configuration.") from exc
    db.commit()
    db.refresh(user)
    return _user_response(user)


def resend_verification_email(db: Session, payload: ForgotPasswordRequest) -> MessageResponse:
    generic_response = MessageResponse(
        message="If the account exists and is not verified, a verification email has been sent."
    )
    email = payload.email.lower()
    if not _is_allowed_email_domain(email):
        return generic_response

    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active or user.is_verified:
        return generic_response

    try:
        _send_verification_email_for_user(db, user)
    except EmailDeliveryError as exc:
        raise AuthError("Could not send verification email. Check email service configuration.") from exc

    db.commit()
    logger.info("Verification email resent for %s", user.email)
    return generic_response


def admin_create_user(db: Session, payload: AdminCreateUserRequest) -> UserResponse:
    email = _require_allowed_email(payload.email)
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise AuthError("A user with this email already exists.")

    is_verified = payload.status == UserStatus.active
    user = User(
        email=email,
        full_name=payload.full_name,
        institution=payload.institution,
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


def list_admin_users(db: Session, *, search: str | None = None) -> list[AdminUserResponse]:
    statement = select(User).order_by(User.created_at.desc(), User.email.asc())
    if search:
        pattern = f"%{search.strip().lower()}%"
        statement = statement.where(
            func.lower(User.email).like(pattern)
            | func.lower(User.full_name).like(pattern)
            | func.lower(User.role).like(pattern)
            | func.lower(User.status).like(pattern)
        )

    users = db.scalars(statement).all()
    if not users:
        return []

    workspace_rows = db.execute(
        select(Workspace.owner_user_id, func.count(Workspace.id))
        .where(Workspace.owner_user_id.in_([user.id for user in users]))
        .group_by(Workspace.owner_user_id)
    ).all()
    workspace_counts = {owner_user_id: int(count) for owner_user_id, count in workspace_rows}
    return [_admin_user_response(user, workspace_counts.get(user.id, 0)) for user in users]


def update_admin_user(
    db: Session,
    *,
    target_user_id: str,
    payload: AdminUpdateUserRequest,
    acting_user: User,
) -> AdminUserResponse:
    user = db.scalar(select(User).where(User.id == target_user_id))
    if user is None:
        raise AuthError("User not found.")

    if user.id == acting_user.id and payload.status == UserStatus.suspended:
        raise AuthError("You cannot suspend your own account.")

    if user.id == acting_user.id and payload.role is not None and payload.role != UserRole.admin:
        raise AuthError("You cannot remove your own admin role.")

    if payload.role is not None:
        user.role = payload.role.value

    if payload.status is not None:
        user.status = payload.status.value
        user.is_active = payload.status != UserStatus.suspended
        user.is_verified = payload.status == UserStatus.active

    user.updated_at = _utcnow()
    db.commit()
    db.refresh(user)

    workspace_count = db.scalar(
        select(func.count(Workspace.id)).where(Workspace.owner_user_id == user.id)
    )
    return _admin_user_response(user, int(workspace_count or 0))


def deactivate_admin_user(db: Session, *, target_user_id: str, acting_user: User) -> MessageResponse:
    user = db.scalar(select(User).where(User.id == target_user_id))
    if user is None:
        raise AuthError("User not found.")
    if user.id == acting_user.id:
        raise AuthError("You cannot deactivate your own account.")

    now = _utcnow()
    user.status = UserStatus.suspended.value
    user.is_active = False
    user.updated_at = now
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.commit()
    return MessageResponse(message="User access deactivated.")


def login_user(
    db: Session,
    payload: LoginRequest,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> TokenPairResponse:
    email = _require_allowed_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise AuthError("Invalid credentials.")

    if not user.is_active or user.status == UserStatus.suspended.value:
        raise AuthError("Your account has been deactivated. Contact an administrator to restore access.")
    if not user.is_verified or user.status == UserStatus.pending_validation.value:
        raise AuthError("Verify your institutional email before signing in.")

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
    email = payload.email.lower()
    generic_response = ForgotPasswordResponse(
        message="If the account exists, a reset link has been sent.",
        debug_reset_token=None,
    )
    if not _is_allowed_email_domain(email):
        return generic_response

    user = db.scalar(select(User).where(User.email == email))

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

    reset_url = _build_frontend_url("reset-password", token=raw_token)
    try:
        send_password_reset_email(to_email=user.email, full_name=user.full_name, reset_url=reset_url)
    except EmailDeliveryError as exc:
        raise AuthError("Could not send password reset email. Check email service configuration.") from exc

    logger.info("Password reset requested for %s", user.email)

    if settings.environment.lower() != "production":
        generic_response.debug_reset_token = raw_token

    return generic_response


def verify_email(db: Session, token: str) -> MessageResponse:
    now = _utcnow()
    token_hash = _token_hash(token)
    verification_row = db.scalar(
        select(EmailVerificationToken).where(
            EmailVerificationToken.token_hash == token_hash,
            EmailVerificationToken.used_at.is_(None),
            EmailVerificationToken.expires_at > now,
        )
    )
    if verification_row is None:
        raise AuthError("Verification token is invalid or expired.")

    user = db.scalar(select(User).where(User.id == verification_row.user_id))
    if user is None or not user.is_active:
        raise AuthError("User account is not available.")

    if not _is_allowed_email_domain(user.email):
        raise AuthError("Only institutional email addresses can be verified.")

    user.is_verified = True
    if user.status == UserStatus.pending_validation.value:
        user.status = UserStatus.active.value
    user.updated_at = now
    verification_row.used_at = now
    db.commit()
    return MessageResponse(message="Email verified successfully.")


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
