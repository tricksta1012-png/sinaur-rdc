import axios from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Intercepteur : attacher le token depuis le store si dispo
apiClient.interceptors.request.use((config) => {
  const raw = localStorage.getItem('sinaur-auth');
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
