import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_BASE_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3000';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  try {
    const token = await SecureStore.getItemAsync('access_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch {}
  return config;
});

export async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync('access_token', accessToken),
    SecureStore.setItemAsync('refresh_token', refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync('access_token'),
    SecureStore.deleteItemAsync('refresh_token'),
  ]);
}
