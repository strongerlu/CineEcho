import { getToken, loadSettings } from './storage';
import type { RemoteMovie, SegmentManifest } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function normalizeServerUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const { serverUrl } = loadSettings();
  if (!serverUrl) throw new ApiError('尚未设置服务器地址', 0);
  const token = await getToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${serverUrl}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status);
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('无法连接服务器', 0);
  } finally {
    clearTimeout(timer);
  }
}

export async function login(serverUrl: string, password: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${normalizeServerUrl(serverUrl)}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status);
    return data.token as string;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('无法连接服务器，请检查地址', 0);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMovies(): Promise<RemoteMovie[]> {
  return (await request<{ movies: RemoteMovie[] }>('/api/movies')).movies;
}

export async function fetchManifest(id: string): Promise<SegmentManifest> {
  return request<SegmentManifest>(`/api/movies/${id}/segments`, {}, 60000);
}

export async function segmentUrl(id: string, file: string): Promise<{ url: string; headers: Record<string, string> }> {
  const { serverUrl } = loadSettings();
  const token = await getToken();
  return {
    url: `${serverUrl}/api/movies/${id}/segments/${file}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

export async function posterUrl(movie: RemoteMovie): Promise<{ url: string; headers: Record<string, string> }> {
  const { url, headers } = await segmentUrl(movie.id, '');
  return { url: url.replace(/\/segments\/$/, `/poster?v=${encodeURIComponent(movie.posterAt ?? '')}`), headers };
}
