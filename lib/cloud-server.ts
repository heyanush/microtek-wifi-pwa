import { createHash, createHmac } from 'node:crypto';
export const API =
  'https://ndp8a9vu2a.execute-api.ap-south-1.amazonaws.com/prod/';
export const COOKIE = 'microtek_session';
export function session(req: Request) {
  const part = req.headers
    .get('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(COOKIE + '='));
  try {
    return part ? decodeURIComponent(part.slice(COOKIE.length + 1)) : '';
  } catch {
    return '';
  }
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return origin === new URL(req.url).origin;
}
export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}
export async function upstream(
  path: string,
  token: string,
  method = 'GET',
  body?: unknown,
) {
  const r = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-VERSION': 'v0',
      'x-app-os-name': 'android',
      'x-app-version': '2.5.14',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(method !== 'GET' && body !== undefined
      ? { body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(30000),
    redirect: 'manual',
  });
  if (r.status >= 300 && r.status < 400)
    throw Error('Unexpected redirect from Microtek.');
  const data = (await r.json().catch(() => ({
    message: 'Microtek returned an unreadable response.',
  }))) as Record<string, unknown>;
  return { data, status: r.status, ok: r.ok };
}
export function signMqtt(config: Record<string, string>, now = new Date()) {
  const host = config.broker.replace(/^\w+:\/\//, '').split('/')[0];
  if (
    !/^[a-zA-Z0-9-]+(?:-ats)?\.iot\.ap-south-1\.amazonaws\.com$/.test(host) ||
    !config.accessKey ||
    !config.secretKey
  )
    throw Error('Unsupported MQTT configuration returned by Microtek.');
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, ''),
    day = date.slice(0, 8),
    scope = `${day}/ap-south-1/iotdevicegateway/aws4_request`;
  const enc = (s: string) =>
    encodeURIComponent(s).replace(
      /[!'()*]/g,
      (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
    );
  const q = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${enc(config.accessKey + '/' + scope)}&X-Amz-Date=${date}&X-Amz-Expires=900&X-Amz-SignedHeaders=host`;
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const hmac = (key: string | Buffer, s: string) =>
    createHmac('sha256', key).update(s).digest();
  const canonical = `GET\n/mqtt\n${q}\nhost:${host}\n\nhost\n${hash('')}`;
  const key = hmac(
    hmac(
      hmac(hmac('AWS4' + config.secretKey, day), 'ap-south-1'),
      'iotdevicegateway',
    ),
    'aws4_request',
  );
  const signature = hmac(
    key,
    `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`,
  ).toString('hex');
  return `wss://${host}/mqtt?${q}&X-Amz-Signature=${signature}`;
}
