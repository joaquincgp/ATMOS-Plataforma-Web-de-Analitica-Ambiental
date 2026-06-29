from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db_session, require_roles
from app.models.user import User
from app.schemas.auth import (
    AdminCreateUserRequest,
    AdminUpdateUserRequest,
    AdminUserResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    LogoutRequest,
    MessageResponse,
    RefreshTokenRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SessionResponse,
    TokenPairResponse,
    UpdateProfileRequest,
    UserResponse,
    UserRole,
)
from app.services.auth_service import (
    AuthError,
    admin_create_user,
    deactivate_admin_user,
    forgot_password,
    list_admin_users,
    login_user,
    logout_user,
    refresh_access_token,
    register_user,
    resend_verification_email,
    reset_password,
    update_admin_user,
    update_profile,
    validate_session,
    verify_email,
)

router = APIRouter()


def _extract_request_context(request: Request) -> tuple[str | None, str | None]:
    user_agent = request.headers.get("user-agent")
    client_ip = request.client.host if request.client else None
    return user_agent, client_ip


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    db: Session = Depends(get_db_session),
) -> UserResponse:
    try:
        return register_user(db, payload)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/admin/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user_by_admin(
    payload: AdminCreateUserRequest,
    db: Session = Depends(get_db_session),
    _admin: User = Depends(require_roles(UserRole.admin)),
) -> UserResponse:
    try:
        return admin_create_user(db, payload)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/admin/users", response_model=list[AdminUserResponse])
def list_users_for_admin(
    search: str | None = Query(default=None, max_length=255),
    db: Session = Depends(get_db_session),
    _admin: User = Depends(require_roles(UserRole.admin)),
) -> list[AdminUserResponse]:
    return list_admin_users(db, search=search)


@router.patch("/admin/users/{user_id}", response_model=AdminUserResponse)
def update_user_by_admin(
    user_id: str,
    payload: AdminUpdateUserRequest,
    db: Session = Depends(get_db_session),
    admin: User = Depends(require_roles(UserRole.admin)),
) -> AdminUserResponse:
    try:
        return update_admin_user(db, target_user_id=user_id, payload=payload, acting_user=admin)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/admin/users/{user_id}", response_model=MessageResponse)
def deactivate_user_by_admin(
    user_id: str,
    db: Session = Depends(get_db_session),
    admin: User = Depends(require_roles(UserRole.admin)),
) -> MessageResponse:
    try:
        return deactivate_admin_user(db, target_user_id=user_id, acting_user=admin)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/login", response_model=TokenPairResponse)
def login(
    payload: LoginRequest,
    request: Request,
    db: Session = Depends(get_db_session),
) -> TokenPairResponse:
    user_agent, client_ip = _extract_request_context(request)
    try:
        return login_user(db, payload, user_agent=user_agent, ip_address=client_ip)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.post("/refresh", response_model=TokenPairResponse)
def refresh_token(
    payload: RefreshTokenRequest,
    request: Request,
    db: Session = Depends(get_db_session),
) -> TokenPairResponse:
    user_agent, client_ip = _extract_request_context(request)
    try:
        return refresh_access_token(db, payload, user_agent=user_agent, ip_address=client_ip)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.post("/logout", response_model=MessageResponse)
def logout(
    payload: LogoutRequest,
    db: Session = Depends(get_db_session),
    _user: User = Depends(get_current_user),
) -> MessageResponse:
    return logout_user(db, payload.refresh_token)


@router.get("/session", response_model=SessionResponse)
def get_session(
    request: Request,
    db: Session = Depends(get_db_session),
    _user: User = Depends(get_current_user),
) -> SessionResponse:
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip()
    try:
        return validate_session(db, token)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.get("/me", response_model=UserResponse)
def get_me(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(user)


@router.patch("/profile", response_model=UserResponse)
def patch_profile(
    payload: UpdateProfileRequest,
    db: Session = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> UserResponse:
    try:
        return update_profile(db, user, payload)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password_route(
    payload: ForgotPasswordRequest,
    db: Session = Depends(get_db_session),
) -> ForgotPasswordResponse:
    try:
        return forgot_password(db, payload)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/resend-verification", response_model=MessageResponse)
def resend_verification_route(
    payload: ForgotPasswordRequest,
    db: Session = Depends(get_db_session),
) -> MessageResponse:
    try:
        return resend_verification_email(db, payload)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/reset-password", response_model=MessageResponse)
def reset_password_route(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db_session),
) -> MessageResponse:
    try:
        return reset_password(db, payload)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/verify-email", response_model=MessageResponse)
def verify_email_route(
    token: str = Query(..., min_length=10),
    db: Session = Depends(get_db_session),
) -> MessageResponse:
    try:
        return verify_email(db, token)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
