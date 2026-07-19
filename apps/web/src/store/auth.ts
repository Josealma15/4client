import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthPayload } from '@4client/shared';

interface AuthState {
  accessToken: string | null;
  user: (AuthPayload & { name: string; email: string; orgName?: string; orgSlug?: string }) | null;
  setAuth: (tokens: { accessToken: string }, user: AuthState['user']) => void;
  clearAuth: () => void;
  setAccessToken: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      setAuth: ({ accessToken }, user) => set({ accessToken, user }),
      clearAuth: () => set({ accessToken: null, user: null }),
      setAccessToken: (token) => set({ accessToken: token }),
    }),
    {
      name: '4client-auth',
      storage: createJSONStorage(() => sessionStorage),
      // Only persist user profile - tokens live in memory (sessionStorage clears on tab close)
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
