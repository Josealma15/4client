import { useAuthStore } from '../store/auth';

const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1';

// Prevent concurrent refresh calls - all 401s share one in-flight refresh
let refreshPromise: Promise<boolean> | null = null;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  // Only treat a 401 as "session expired, try to refresh" when this request actually
  // carried a session token. Without this guard, a 401 from e.g. login with a wrong
  // password (no token attached - nothing to refresh) triggered a doomed refresh
  // attempt anyway, which always failed and overwrote the real "Credenciales
  // incorrectas" server message with a generic "UNAUTHORIZED" error.
  if (res.status === 401 && token) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, options);
    useAuthStore.getState().clearAuth();
    throw new Error('UNAUTHORIZED');
  }

  const data = await res.json();
  if (!res.ok) {
    // Carry the full response body on the thrown error (not just the top-level
    // message) so callers that need structured detail - e.g. cierre's list of
    // orders still missing a decision - don't have to re-fetch or guess.
    const err = new Error(data?.error ?? 'Error del servidor') as Error & { code?: string; data?: any };
    err.code = data?.code;
    err.data = data;
    throw err;
  }
  return data;
}

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function doRefresh(): Promise<boolean> {
  const { setAccessToken, clearAuth } = useAuthStore.getState();
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      // No body is sent - the refresh token lives in the HttpOnly cookie, nothing else
      // is needed. A 'Content-Type: application/json' header with no body made Fastify
      // reject every single refresh attempt with 400 FST_ERR_CTP_EMPTY_JSON_BODY before
      // the route handler (and its cookie check) ever ran - this is THE actual cause of
      // "session closes on reload/refresh": refresh never worked, full stop, regardless
      // of the cookie's SameSite/Secure attributes being correct.
      credentials: 'include', // HttpOnly cookie sent automatically
    });
    if (!res.ok) {
      // Diagnostic only - this is the one path that keeps causing "session closes
      // out of nowhere" reports with no way to tell WHY from the outside. Next time
      // it happens, check the browser console for this line: it tells us whether the
      // cookie made it to the server at all (401 body) vs the request never reached
      // it (network/CORS failure, caught below) vs it's a real expiry/reuse case.
      const body = await res.json().catch(() => null);
      console.error('[auth] refresh failed', { status: res.status, code: body?.code, error: body?.error });
      clearAuth();
      return false;
    }
    const { data } = await res.json();
    setAccessToken(data.accessToken);
    return true;
  } catch (err) {
    console.error('[auth] refresh request threw (network/CORS failure, not a server response)', err);
    clearAuth();
    return false;
  }
}

export const api = {
  get:    <T>(path: string) => request<T>(path),
  post:   <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// Call on app init to restore access token from HttpOnly cookie if session exists
export async function tryRestoreSession(): Promise<boolean> {
  if (useAuthStore.getState().accessToken) return true;
  if (!useAuthStore.getState().user) return false; // no persisted user = fresh start
  return doRefresh();
}
