from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AuthBaseModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("email", check_fields=False)
    @classmethod
    def validate_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not EMAIL_PATTERN.match(email):
            raise ValueError("Invalid email format.")
        return email


class UserRole(StrEnum):
    admin = "admin"
    researcher = "researcher"
    generic = "generic"


class UserStatus(StrEnum):
    pending_validation = "pending_validation"
    active = "active"
    suspended = "suspended"


class UserResponse(AuthBaseModel):
    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)

    id: str
    email: str
    full_name: str
    role: UserRole
    status: UserStatus
    is_active: bool
    is_verified: bool
    created_at: datetime


class LoginRequest(AuthBaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)


class RegisterRequest(AuthBaseModel):
    email: str
    full_name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=8, max_length=128)


class AdminCreateUserRequest(RegisterRequest):
    role: UserRole = UserRole.researcher
    status: UserStatus = UserStatus.active


class TokenPairResponse(AuthBaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_expires_in: int
    user: UserResponse


class RefreshTokenRequest(AuthBaseModel):
    refresh_token: str = Field(min_length=10)


class LogoutRequest(AuthBaseModel):
    refresh_token: str = Field(min_length=10)


class SessionResponse(AuthBaseModel):
    authenticated: bool
    user: UserResponse


class ForgotPasswordRequest(AuthBaseModel):
    email: str


class ForgotPasswordResponse(AuthBaseModel):
    message: str
    debug_reset_token: str | None = None


class ResetPasswordRequest(AuthBaseModel):
    token: str = Field(min_length=10)
    new_password: str = Field(min_length=8, max_length=128)


class MessageResponse(AuthBaseModel):
    message: str


class UpdateProfileRequest(AuthBaseModel):
    full_name: str = Field(min_length=2, max_length=255)
