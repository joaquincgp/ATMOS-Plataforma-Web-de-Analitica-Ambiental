import { env } from '@/shared/config/env';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
  auth?: boolean;
  timeout?: number;
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
  loc?: (string | number)[];
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
      .filter((value) => Boolean(value?.trim()));

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

  const timeoutMs = options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = !options.signal ? new AbortController() : null;
  // Tracks whether *our* timeout fired (as opposed to a caller-supplied signal),
  // so the rejection carries a readable message instead of the browser's raw
  // "signal is aborted without reason", which leaked straight into the UI.
  let timedOut = false;
  const timeoutId = controller
    ? window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;

  try {
    const response = await fetch(url.toString(), {
      ...options,
      headers,
      signal: options.signal ?? controller?.signal,
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

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    if (timedOut) {
      // Keep the AbortError name so existing `name === 'AbortError'` checks
      // (e.g. the public dashboard's error normalizer) keep behaving the same,
      // but give callers that surface `error.message` something a user can read.
      const timeoutError = new Error(
        `La solicitud superó el tiempo de espera de ${Math.round(timeoutMs / 1000)} s. ` +
          'El servidor puede estar ocupado procesando datos; vuelve a intentar en unos momentos.',
      );
      timeoutError.name = 'AbortError';
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}
