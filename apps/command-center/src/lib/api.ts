import axios from 'axios';

// En production Railway, VITE_API_BASE_URL pointe vers l'URL publique de l'API.
// En développement Docker, /api est proxié par nginx vers http://api:3000.
const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export const apiClient = axios.create({
  baseURL: BASE || '/api',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const raw = localStorage.getItem('sinaur-cc-auth');
  if (raw) {
    try {
      const { state } = JSON.parse(raw) as { state: { tokens?: { accessToken: string } } };
      if (state.tokens?.accessToken) {
        config.headers.Authorization = `Bearer ${state.tokens.accessToken}`;
      }
    } catch {}
  }
  return config;
});

apiClient.interceptors.response.use(
  r => r,
  async err => {
    if (err.response?.status === 401) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);
