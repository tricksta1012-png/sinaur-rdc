import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { api, saveTokens, clearTokens } from '../lib/api.js';

interface AuthUser {
  sub: string;
  email: string;
  role: string;
  scope: string[];
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  biometricAvailable: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithBiometric: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  biometricAvailable: false,
  login: async () => {},
  loginWithBiometric: async () => {},
  logout: async () => {},
});

function parseJwtPayload(token: string): AuthUser | null {
  try {
    const b64 = token.split('.')[1];
    const json = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    void (async () => {
      const [token, biometricTypes] = await Promise.all([
        SecureStore.getItemAsync('access_token').catch(() => null),
        LocalAuthentication.supportedAuthenticationTypesAsync().catch(() => []),
      ]);

      setBiometricAvailable(biometricTypes.length > 0);

      if (token) {
        const payload = parseJwtPayload(token);
        if (payload && payload.exp * 1000 > Date.now()) {
          setUser(payload);
          setIsAuthenticated(true);
        } else {
          await clearTokens();
        }
      }
      setIsLoading(false);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<{ data: { accessToken: string; refreshToken: string } }>(
      '/auth/login',
      { email, password },
    );
    const { accessToken, refreshToken } = data.data;
    await saveTokens(accessToken, refreshToken);
    const payload = parseJwtPayload(accessToken);
    setUser(payload);
    setIsAuthenticated(true);
  }, []);

  const loginWithBiometric = useCallback(async () => {
    const token = await SecureStore.getItemAsync('access_token');
    if (!token) throw new Error('Aucune session enregistrée');

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Déverrouillez SINAUR-RDC',
      fallbackLabel: 'Utiliser le mot de passe',
      disableDeviceFallback: false,
    });

    if (!result.success) throw new Error('Authentification biométrique échouée');

    const payload = parseJwtPayload(token);
    if (!payload || payload.exp * 1000 <= Date.now()) {
      await clearTokens();
      throw new Error('Session expirée, reconnectez-vous');
    }
    setUser(payload);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    await clearTokens();
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, user, biometricAvailable, login, loginWithBiometric, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
