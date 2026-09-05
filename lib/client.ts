import { directRequest } from '@/lib/direct-cloud';
export async function request<T = Record<string, unknown>>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('github.io'))
    return directRequest(path, options) as Promise<T>;
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const r = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers,
    signal: options.signal || AbortSignal.timeout(35000),
  });
  const data = (await r.json().catch(() => ({
    message: 'The server returned an unreadable response.',
  }))) as Record<string, unknown>;
  if (!r.ok)
    throw Error(
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : `Request failed (${r.status}).`,
    );
  return data as T;
}
export type HomeInfo = { id: string; name: string; is_default?: boolean };
export type CloudResponse = {
  things?: Record<string, unknown>[];
  homes?: HomeInfo[];
  data?: Record<string, unknown>;
};
export function cloud(path: string, query: Record<string, string> = {}) {
  return request<CloudResponse>(
    '/api/cloud?' + new URLSearchParams({ path, ...query }),
  );
}
export type Bridge = {
  key: string;
  ip: string;
  uat: string;
  password: string;
  transport: 'direct' | 'lan';
};
export async function bridge(config: Bridge, command?: Record<string, number>) {
  return request(
    'http://127.0.0.1:8788/' +
      (config.transport === 'lan' ? 'lan/' : '') +
      (command ? 'command' : 'state'),
    {
      method: 'POST',
      headers: { 'x-bridge-key': config.key },
      body: JSON.stringify({
        ip: config.ip,
        uat: config.uat,
        password: config.password,
        ...(command ? { command } : {}),
      }),
    },
  );
}
