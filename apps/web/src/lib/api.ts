import { useAuthStore } from '../store/auth';

const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1';

// Prevent concurrent refresh calls — all 401s share one in-flight refresh
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
  // password (no token attached — nothing to refresh) triggered a doomed refresh
  // attempt anyway, which always failed and overwrote the real "Credenciales
  // incorrectas" server message with a generic "UNAUTHORIZED" error.
  if (res.status === 401 && token) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, options);
    useAuthStore.getState().clearAuth();
    throw new Error('UNAUTHORIZED');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? 'Error del servidor');
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
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // HttpOnly cookie sent automatically
    });
    if (!res.ok) { clearAuth(); return false; }
    const { data } = await res.json();
    setAccessToken(data.accessToken);
    return true;
  } catch {
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
