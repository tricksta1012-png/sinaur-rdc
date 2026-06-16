import axios from 'axios';

// En production Railway, VITE_API_BASE_URL pointe vers l'URL publique de l'API.
// En développement Docker, /api est proxié par nginx vers http://api:3000.
const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export const apiClient = axios.create({
  baseURL: BASE || '/api',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Authorization header is set on apiClient.defaults.headers.common by:
//   - auth store login() after successful authentication
//   - auth store onRehydrateStorage() on page reload
// No need to re-read localStorage here.

apiClient.interceptors.response.use(
  r => r,
  async err => {
    const url: string = err.config?.url ?? '';
    const isAuthEndpoint = url.includes('/auth/');
    if (err.response?.status === 401 && !isAuthEndpoint) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);
