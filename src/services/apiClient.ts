import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export interface ApiRequestOptions {
  token?: string | null;
  timeout?: number;
  headers?: Record<string, string>;
  baseUrl?: string;
  useLocalStorageToken?: boolean;
  signal?: AbortSignal;
}

function getStoredToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('vutt_token');
}

function buildUrl(path: string, baseUrl = FILE_API_URL): string {
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith(baseUrl)) return path;
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const obj = data as { detail?: unknown; message?: unknown; error?: unknown };
    const msg = obj.detail ?? obj.message ?? obj.error;
    if (typeof msg === 'string' && msg) return msg;
  }
  if (typeof data === 'string' && data) return data;
  return fallback;
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {}
): Promise<T> {
  const token = options.token ?? (options.useLocalStorageToken ? getStoredToken() : null);
  const headers: Record<string, string> = {
    ...getAuthHeaders(token),
    ...options.headers,
  };

  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    requestBody = headers['Content-Type'] === 'application/json'
      ? JSON.stringify(body)
      : body as BodyInit;
  }

  const response = await fetchWithTimeout(buildUrl(path, options.baseUrl), {
    method,
    headers,
    body: requestBody,
    timeout: options.timeout,
    signal: options.signal,
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new ApiError(getErrorMessage(data, `HTTP ${response.status}`), response.status, data);
  }

  return data as T;
}

export function apiGet<T>(path: string, options?: ApiRequestOptions): Promise<T> {
  return apiRequest<T>('GET', path, undefined, options);
}

export function apiPost<T>(path: string, body: unknown = {}, options?: ApiRequestOptions): Promise<T> {
  return apiRequest<T>('POST', path, body, options);
}

export function apiPut<T>(path: string, body: unknown = {}, options?: ApiRequestOptions): Promise<T> {
  return apiRequest<T>('PUT', path, body, options);
}

export function apiDelete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
  return apiRequest<T>('DELETE', path, undefined, options);
}
