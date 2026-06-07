import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthTokens, JwtPayload } from '@sinaur/shared-types';
import { apiClient } from '../lib/api.js';

function decodeJwt(token: string): JwtPayload | null {
  try {
    const payload = token.split('.')[1]
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(decoded) as JwtPayload
  } catch {
    return null
  }
}

interface AuthState {
  user: JwtPayload | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithOtp: (phone: string, otpCode: string) => Promise<void>;
  logout: () => void;
  refreshTokens: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,

      login: async (email, password) => {
        const { data } = await apiClient.post<{ success: boolean; data: AuthTokens }>('/auth/login', { email, password });
        const tokens = data.data!;
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${tokens.accessToken}`;
        set({ tokens, isAuthenticated: true, user: decodeJwt(tokens.accessToken) });
      },

      loginWithOtp: async (phone, otpCode) => {
        const { data } = await apiClient.post<{ success: boolean; data: AuthTokens }>('/auth/login', { phone, otpCode });
        const tokens = data.data!;
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${tokens.accessToken}`;
        set({ tokens, isAuthenticated: true, user: decodeJwt(tokens.accessToken) });
      },

      logout: () => {
        delete apiClient.defaults.headers.common['Authorization'];
        set({ user: null, tokens: null, isAuthenticated: false });
      },

      refreshTokens: async () => {
        const { tokens } = get();
        if (!tokens?.refreshToken) return;
        try {
          const { data } = await apiClient.post<{ success: boolean; data: { accessToken: string; expiresIn: number } }>(
            '/auth/refresh', { refreshToken: tokens.refreshToken },
          );
          const newTokens = { ...tokens, accessToken: data.data!.accessToken };
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${newTokens.accessToken}`;
          set({ tokens: newTokens, user: decodeJwt(newTokens.accessToken) });
        } catch {
          get().logout();
        }
      },
    }),
    {
      name: 'sinaur-auth',
      partialize: (s) => ({ tokens: s.tokens, isAuthenticated: s.isAuthenticated, user: s.user }),
    },
  ),
);
