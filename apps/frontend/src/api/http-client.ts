import { env } from '@/shared/config/env';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
  auth?: boolean;
}

type AccessTokenGetter = () => string | null;
type UnauthorizedHandler = () => void;

let accessTokenGetter: AccessTokenGetter | null = null;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function configureHttpClientAuth({
  getAccessToken,
  onUnauthorized,
}: {
  getAccessToken: AccessTokenGetter;
  onUnauthorized: UnauthorizedHandler;
}) {
  accessTokenGetter = getAccessToken;
  unauthorizedHandler = onUnauthorized;
}

interface ApiValidationIssue {
  loc?: Array<string | number>;
  msg?: string;
}

function extractApiErrorMessage(payload: unknown, status: number): string {
  if (!payload || typeof payload !== 'object') {
    return `API request failed: ${status}`;
  }

  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const parts = detail
      .map((issue) => {
        const typedIssue = issue as ApiValidationIssue;
        const fieldPath = Array.isArray(typedIssue.loc) ? typedIssue.loc.join('.') : '';
        const reason = typedIssue.msg ?? 'Invalid value.';
        return fieldPath ? `${fieldPath}: ${reason}` : reason;
      })
      .filter((value) => Boolean(value && value.trim()));

    if (parts.length > 0) {
      return parts.join(' | ');
    }
  }

  return `API request failed: ${status}`;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${env.apiBaseUrl}${path}`);
  const withAuth = options.auth ?? true;

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const hasFormDataBody = options.body instanceof FormData;
  const headers = new Headers(options.headers ?? undefined);
  if (!hasFormDataBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (withAuth && !headers.has('Authorization') && accessTokenGetter) {
    const token = accessTokenGetter();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(url.toString(), {
    ...options,
    headers,
  });

  if (withAuth && response.status === 401 && unauthorizedHandler) {
    unauthorizedHandler();
  }

  if (!response.ok) {
    let detail = `API request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as unknown;
      detail = extractApiErrorMessage(payload, response.status);
    } catch {
      // Keep fallback detail
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}
