import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export function privateIPv4(value) {
  if (typeof value !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(value))
    return false;
  const n = value.split('.').map(Number);
  return (
    n.every((v) => v >= 0 && v <= 255) &&
    (n[0] === 10 ||
      (n[0] === 192 && n[1] === 168) ||
      (n[0] === 172 && n[1] >= 16 && n[1] <= 31))
  );
}
export function validateCommand(c) {
  if (
    !c ||
    typeof c !== 'object' ||
    Array.isArray(c) ||
    Object.keys(c).length !== 1
  )
    throw Error('One setting is required.');
  const [k] = Object.keys(c);
  if (
    ![
      'pow',
      'ups',
      'buzz',
      'vacation',
      'turbochrgsts',
      'highpwr',
      'mainscut',
    ].includes(k) ||
    ![0, 1].includes(c[k])
  )
    throw Error('Unsupported command.');
  return c;
}
function key(password) {
  const value = Buffer.from(password.slice(0, 16).padEnd(16, '\0'), 'utf8');
  if (value.length !== 16) throw Error('Device key must use ASCII characters.');
  return value;
}
// Matches DataUtils: encrypt an IV-prefixed plaintext, then transmit all ciphertext.
export function encryptLan(value, password, iv = randomBytes(16)) {
  const cipher = createCipheriv('aes-128-cbc', key(password), iv);
  return Buffer.concat([
    cipher.update(
      Buffer.concat([iv, Buffer.from(JSON.stringify(value), 'latin1')]),
    ),
    cipher.final(),
  ]).toString('base64');
}
export function decryptLan(encoded, password) {
  const b = Buffer.from(encoded, 'base64');
  if (b.length < 32 || b.length % 16) throw Error('Invalid device packet.');
  const cipher = createDecipheriv(
    'aes-128-cbc',
    key(password),
    b.subarray(0, 16),
  );
  cipher.setAutoPadding(false);
  let text = Buffer.concat([
    cipher.update(b.subarray(16)),
    cipher.final(),
  ]).toString('utf8');
  while (text.length && text.charCodeAt(text.length - 1) <= 32)
    text = text.slice(0, -1);
  return JSON.parse(text);
}
export async function directRequest({ ip, uat, command }, fetcher = fetch) {
  if (!privateIPv4(ip))
    throw Error('Enter a private IPv4 address for your inverter.');
  if (typeof uat !== 'string' || !uat || uat.length > 4096)
    throw Error('Device access token is required.');
  const url = new URL(`http://${ip}/${command ? 'sds' : 'gds'}`);
  if (!command) url.searchParams.set('uat', uat);
  const response = await fetcher(url, {
    method: command ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: command ? { 'Content-Type': 'application/json' } : {},
    body: command
      ? JSON.stringify({ ...validateCommand(command), uat })
      : undefined,
  });
  if (!response.ok) throw Error(`Inverter returned HTTP ${response.status}.`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    if (command)
      return { message: text || 'Command sent. Waiting for device report.' };
    throw Error('Inverter returned invalid status data.');
  }
}
