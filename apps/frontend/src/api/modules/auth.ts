import { apiRequest } from '@/api/http-client';

export type UserRole = 'admin' | 'researcher' | 'generic';
export type UserStatus = 'pending_validation' | 'active' | 'suspended';

export interface UserResponse {
  id: string;
  email: string;
  full_name: string;
  institution: string | null;
  job_title: string | null;
  department: string | null;
  phone: string | null;
  country: string | null;
  role: UserRole;
  status: UserStatus;
  is_active: boolean;
  is_verified: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminUserResponse extends UserResponse {
  workspace_count: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  full_name: string;
  institution?: string | null;
  password: string;
}

export interface TokenPairResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  refresh_expires_in: number;
  user: UserResponse;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface MessageResponse {
  message: string;
}

export interface SessionResponse {
  authenticated: boolean;
  user: UserResponse;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ForgotPasswordResponse {
  message: string;
  debug_reset_token?: string | null;
}

export interface ResetPasswordRequest {
  token: string;
  new_password: string;
}

export interface UpdateProfileRequest {
  full_name: string;
  institution?: string | null;
  job_title?: string | null;
  department?: string | null;
  phone?: string | null;
  country?: string | null;
}

export interface AdminUpdateUserRequest {
  role?: UserRole;
  status?: UserStatus;
}

export function registerUser(payload: RegisterRequest): Promise<UserResponse> {
  return apiRequest<UserResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
    auth: false,
  });
}

export function loginUser(payload: LoginRequest): Promise<TokenPairResponse> {
  return apiRequest<TokenPairResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
    auth: false,
  });
}

export function refreshAccessToken(payload: RefreshTokenRequest): Promise<TokenPairResponse> {
  return apiRequest<TokenPairResponse>('/api/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify(payload),
    auth: false,
  });
}

export function logoutUser(refreshToken: string): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/api/v1/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export function getSession(): Promise<SessionResponse> {
  return apiRequest<SessionResponse>('/api/v1/auth/session');
}

export function getMe(): Promise<UserResponse> {
  return apiRequest<UserResponse>('/api/v1/auth/me');
}

export function forgotPassword(payload: ForgotPasswordRequest): Promise<ForgotPasswordResponse> {
  return apiRequest<ForgotPasswordResponse>('/api/v1/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify(payload),
    auth: false,
  });
}

export function resendVerification(payload: ForgotPasswordRequest): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/api/v1/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify(payload),
    auth: false,
  });
}

export function resetPassword(payload: ResetPasswordRequest): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/api/v1/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(payload),
    auth: false,
  });
}

export function verifyEmail(token: string): Promise<MessageResponse> {
  return apiRequest<MessageResponse>(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    auth: false,
  });
}

export function updateProfile(payload: UpdateProfileRequest): Promise<UserResponse> {
  return apiRequest<UserResponse>('/api/v1/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function listAdminUsers(search?: string): Promise<AdminUserResponse[]> {
  const params = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return apiRequest<AdminUserResponse[]>(`/api/v1/auth/admin/users${params}`);
}

export function updateAdminUser(userId: string, payload: AdminUpdateUserRequest): Promise<AdminUserResponse> {
  return apiRequest<AdminUserResponse>(`/api/v1/auth/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deactivateAdminUser(userId: string): Promise<MessageResponse> {
  return apiRequest<MessageResponse>(`/api/v1/auth/admin/users/${userId}`, {
    method: 'DELETE',
  });
}
