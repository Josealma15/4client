import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthPayload } from '@4client/shared';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: (AuthPayload & { name: string; email: string }) | null;
  setAuth: (tokens: { accessToken: string; refreshToken: string }, user: AuthState['user']) => void;
  clearAuth: () => void;
  setAccessToken: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setAuth: (tokens, user) => set({ ...tokens, user }),
      clearAuth: () => set({ accessToken: null, refreshToken: null, user: null }),
      setAccessToken: (token) => set({ accessToken: token }),
    }),
    { name: '4client-auth' },
  ),
);
