import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthTokens } from '@sinaur/shared-types';
import { apiClient } from '../lib/api.js';

export interface JwtUser {
  sub: string;
  email?: string;
  role: string;
  scope: string[];
}

function decodeJwt(token: string): JwtUser | null {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return { sub: decoded.sub, email: decoded.email, role: decoded.role, scope: decoded.scope ?? [] };
  } catch {
    return null;
  }
}

interface AuthState {
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  user: JwtUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      tokens: null,
      isAuthenticated: false,
      user: null,

      login: async (email, password) => {
        const { data } = await apiClient.post<{ success: boolean; data: AuthTokens }>('/auth/login', { email, password });
        const tokens = data.data!;
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${tokens.accessToken}`;
        const user = decodeJwt(tokens.accessToken);
        set({ tokens, isAuthenticated: true, user });
      },

      logout: () => {
        delete apiClient.defaults.headers.common['Authorization'];
        set({ tokens: null, isAuthenticated: false, user: null });
      },
    }),
    {
      name: 'sinaur-cc-auth',
      partialize: (s) => ({ tokens: s.tokens, isAuthenticated: s.isAuthenticated }),
      onRehydrateStorage: () => (state) => {
        if (state?.tokens?.accessToken) {
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${state.tokens.accessToken}`;
          const user = decodeJwt(state.tokens.accessToken);
          state.user = user;
        }
      },
    },
  ),
);
