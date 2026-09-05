const API = 'https://ndp8a9vu2a.execute-api.ap-south-1.amazonaws.com/prod/';
const TOKEN = 'microtek_access_token';
const EXPIRES = 'microtek_access_token_expires';

function savedToken() {
  const token = localStorage.getItem(TOKEN) || sessionStorage.getItem(TOKEN) || '';
  const expires = Number(localStorage.getItem(EXPIRES));
  if (expires && Date.now() >= expires) {
    localStorage.removeItem(TOKEN);
    localStorage.removeItem(EXPIRES);
    sessionStorage.removeItem(TOKEN);
    return '';
  }
  if (token && !localStorage.getItem(TOKEN)) {
    localStorage.setItem(TOKEN, token);
    sessionStorage.removeItem(TOKEN);
  }
  return token;
}

const headers = (token = '') => ({
  'Content-Type': 'application/json', 'X-API-VERSION': 'v0',
  'X-OS-NAME': 'android', 'X-APP-VERSION': '2.5.14',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(API + path, { method, headers: headers(savedToken()), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({ message: 'Microtek returned an unreadable response.' })) as Record<string, any>;
  if (!response.ok) throw Error(data.message || `Microtek request failed (${response.status}).`);
  return data;
}

export async function directRequest(path: string, options: RequestInit = {}) {
  if (path === '/api/session' && (!options.method || options.method === 'GET')) return { signedIn: !!savedToken() };
  if (path === '/api/session' && options.method === 'DELETE') { localStorage.removeItem(TOKEN); localStorage.removeItem(EXPIRES); sessionStorage.removeItem(TOKEN); return { signedIn: false }; }
  if (path === '/api/session' && options.method === 'POST') {
    const body = JSON.parse(String(options.body || '{}'));
    const endpoint = body.action === 'otp' ? 'auth/requestOtp' : body.action === 'signup' ? 'auth/signup' : body.action === 'reset' ? 'auth/setPassword' : 'auth/login';
    const payload = body.action === 'login' ? { auth_id: body.auth_id, country_code: body.country_code, data: { via: body.via, value: body.value } } : body.action === 'otp' ? { data: { auth_id: body.auth_id, country_code: body.country_code }, reason: body.reason } : body;
    const data = await api(endpoint, 'POST', payload);
    if (body.action === 'login' && data.access_token) {
      localStorage.setItem(TOKEN, data.access_token);
      localStorage.setItem(EXPIRES, String(Date.now() + Math.min(Math.max(Number(data.expires_in) || 86400, 60), 86400) * 1000));
    }
    return body.action === 'login' ? { signedIn: true } : data;
  }
  if (path.startsWith('/api/cloud?')) {
    const params = new URLSearchParams(path.split('?')[1]); const endpoint = params.get('path') || ''; params.delete('path');
    return api(endpoint + (params.size ? `?${params}` : ''));
  }
  if (path === '/api/cloud' && options.method === 'POST') {
    const body = JSON.parse(String(options.body || '{}')); return api(`things/${body.id}/userConfig`, 'POST', { name: body.name });
  }
  if (path === '/api/mqtt') { const config = await api('config') as Record<string, string>; return { url: await signMqtt(config) }; }
  throw Error('Unsupported direct request.');
}

async function signMqtt(c: Record<string, string>) {
  const host = c.broker.replace(/^\w+:\/\//, '').split('/')[0], now = new Date();
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = date.slice(0, 8), scope = `${day}/ap-south-1/iotdevicegateway/aws4_request`;
  const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, x => '%' + x.charCodeAt(0).toString(16).toUpperCase());
  const q = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${enc(c.accessKey + '/' + scope)}&X-Amz-Date=${date}&X-Amz-Expires=900&X-Amz-SignedHeaders=host`;
  const bytes = (s: string) => new TextEncoder().encode(s), hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const hash = async (s: string) => hex(await crypto.subtle.digest('SHA-256', bytes(s)));
  const hmac = async (key: BufferSource | string, s: string) => { const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? bytes(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return crypto.subtle.sign('HMAC', k, bytes(s)); };
  const canonical = `GET\n/mqtt\n${q}\nhost:${host}\n\nhost\n${await hash('')}`;
  const kDate = await hmac('AWS4' + c.secretKey, day), kRegion = await hmac(kDate, 'ap-south-1'), kService = await hmac(kRegion, 'iotdevicegateway'), key = await hmac(kService, 'aws4_request');
  const signature = hex(await hmac(key, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${await hash(canonical)}`));
  return `wss://${host}/mqtt?${q}&X-Amz-Signature=${signature}`;
}
