import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { configureHttpClientAuth } from '@/api/http-client';
import {
  deleteOwnAccount,
  forgotPassword,
  getSession,
  loginUser,
  logoutUser,
  refreshAccessToken,
  registerUser,
  resetPassword,
  updateProfile,
  type ForgotPasswordResponse,
  type RegisterRequest,
  type ResetPasswordRequest,
  type UpdateProfileRequest,
  type UserResponse,
} from '@/api/modules/auth';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserResponse | null;
}

interface LoginInput {
  email: string;
  password: string;
}

interface AuthContextValue {
  user: UserResponse | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<UserResponse>;
  register: (payload: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  forgotPassword: (email: string) => Promise<ForgotPasswordResponse>;
  resetPassword: (payload: ResetPasswordRequest) => Promise<void>;
  refreshSession: () => Promise<boolean>;
  updateUserProfile: (payload: UpdateProfileRequest) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AUTH_STORAGE_KEY = 'atmos.auth.v1';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function loadStoredAuthState(): AuthState {
  if (typeof window === 'undefined') {
    return { accessToken: null, refreshToken: null, user: null };
  }

  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return { accessToken: null, refreshToken: null, user: null };
  }

  try {
    const parsed = JSON.parse(raw) as AuthState;
    return {
      accessToken: parsed.accessToken ?? null,
      refreshToken: parsed.refreshToken ?? null,
      user: parsed.user ?? null,
    };
  } catch {
    return { accessToken: null, refreshToken: null, user: null };
  }
}

function persistAuthState(state: AuthState) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!state.accessToken || !state.refreshToken || !state.user) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>(() => loadStoredAuthState());
  const [isLoading, setIsLoading] = useState(true);
  const accessTokenRef = useRef<string | null>(authState.accessToken);
  const refreshTokenRef = useRef<string | null>(authState.refreshToken);

  const clearAuthState = useCallback(() => {
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    setAuthState({ accessToken: null, refreshToken: null, user: null });
  }, []);

  const applyTokenPair = useCallback(
    (payload: {
      access_token: string;
      refresh_token: string;
      user: UserResponse;
    }) => {
      accessTokenRef.current = payload.access_token;
      refreshTokenRef.current = payload.refresh_token;
      setAuthState({
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        user: payload.user,
      });
    },
    [],
  );

  const refreshSession = useCallback(async (): Promise<boolean> => {
    const currentRefreshToken = refreshTokenRef.current;
    if (!currentRefreshToken) {
      clearAuthState();
      return false;
    }

    try {
      const response = await refreshAccessToken({ refresh_token: currentRefreshToken });
      applyTokenPair(response);
      return true;
    } catch {
      clearAuthState();
      return false;
    }
  }, [applyTokenPair, clearAuthState]);

  useEffect(() => {
    configureHttpClientAuth({
      getAccessToken: () => accessTokenRef.current,
      onUnauthorized: () => {
        void refreshSession();
      },
    });
  }, [refreshSession]);

  useEffect(() => {
    persistAuthState(authState);
  }, [authState]);

  useEffect(() => {
    const bootstrap = async () => {
      if (!authState.accessToken) {
        setIsLoading(false);
        return;
      }

      try {
        const session = await getSession();
        setAuthState((current) => ({ ...current, user: session.user }));
      } catch {
        const refreshed = await refreshSession();
        if (!refreshed) {
          clearAuthState();
        }
      } finally {
        setIsLoading(false);
      }
    };

    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (input: LoginInput) => {
      const response = await loginUser(input);
      applyTokenPair(response);
      return response.user;
    },
    [applyTokenPair],
  );

  const register = useCallback(async (payload: RegisterRequest) => {
    await registerUser(payload);
  }, []);

  const logout = useCallback(async () => {
    if (authState.refreshToken) {
      try {
        await logoutUser(authState.refreshToken);
      } catch {
        // Logout should still clear local session even if API call fails.
      }
    }
    clearAuthState();
  }, [authState.refreshToken, clearAuthState]);

  const requestPasswordReset = useCallback(async (email: string) => {
    return forgotPassword({ email });
  }, []);

  const confirmPasswordReset = useCallback(async (payload: ResetPasswordRequest) => {
    await resetPassword(payload);
  }, []);

  const updateUserProfile = useCallback(async (payload: UpdateProfileRequest) => {
    const updated = await updateProfile(payload);
    setAuthState((current) => ({ ...current, user: updated }));
  }, []);

  const deleteAccount = useCallback(async () => {
    await deleteOwnAccount();
    clearAuthState();
  }, [clearAuthState]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: authState.user,
      accessToken: authState.accessToken,
      refreshToken: authState.refreshToken,
      isAuthenticated: Boolean(authState.accessToken && authState.user),
      isLoading,
      login,
      register,
      logout,
      forgotPassword: requestPasswordReset,
      resetPassword: confirmPasswordReset,
      refreshSession,
      updateUserProfile,
      deleteAccount,
    }),
    [
      authState.user,
      authState.accessToken,
      authState.refreshToken,
      isLoading,
      login,
      register,
      logout,
      requestPasswordReset,
      confirmPasswordReset,
      refreshSession,
      updateUserProfile,
      deleteAccount,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
