/**
 * Client HTTP interne vers le service ai-prediction.
 * Ajoute automatiquement le header X-Internal-API-Key et gère les erreurs.
 */
import axios, { type AxiosRequestConfig } from 'axios';
import { config } from '../config.js';

const ai = axios.create({
  baseURL: config.AI_SERVICE_URL,
  timeout: 30_000,
  headers: { 'X-Internal-API-Key': config.AI_INTERNAL_API_KEY },
  validateStatus: () => true,   // on gère les codes HTTP nous-mêmes
});

export interface AiResponse<T = unknown> {
  status: number;
  data: T;
}

export async function aiGet<T = unknown>(
  path: string,
  params?: Record<string, string | number | boolean>,
  headers?: Record<string, string>,
): Promise<AiResponse<T>> {
  const res = await ai.get<T>(path, { params, headers } as AxiosRequestConfig);
  return { status: res.status, data: res.data };
}

export async function aiPost<T = unknown>(
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
  timeoutMs?: number,
): Promise<AiResponse<T>> {
  const res = await ai.post<T>(path, body, { headers, timeout: timeoutMs } as AxiosRequestConfig);
  return { status: res.status, data: res.data };
}

/** Vérifie que le service ai-prediction répond (pour le health check global). */
export async function aiHealthCheck(): Promise<boolean> {
  try {
    const res = await ai.get('/health', { timeout: 5_000 });
    return res.status === 200;
  } catch {
    return false;
  }
}
