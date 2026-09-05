import { textValue } from '@/lib/protocol';
import {
  COOKIE,
  session,
  sameOrigin,
  json,
  upstream,
} from '@/lib/cloud-server';
export async function GET(req: Request) {
  return json({ signedIn: !!session(req) });
}
export async function POST(req: Request) {
  if (!sameOrigin(req))
    return json({ message: 'Invalid request origin.' }, 403);
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action;
    if (
      typeof action !== 'string' ||
      !['login', 'otp', 'signup', 'reset'].includes(action)
    )
      return json({ message: 'Invalid action.' }, 400);
    if (
      typeof body.auth_id !== 'string' ||
      body.auth_id.length > 254 ||
      !body.auth_id.trim()
    )
      return json({ message: 'Enter your mobile number or email.' }, 400);
    const auth_id = body.auth_id.trim(),
      country_code = textValue(body.country_code) || '+91';
    let path = 'auth/login',
      payload: unknown;
    if (action === 'otp') {
      path = 'auth/requestOtp';
      payload = {
        data: { auth_id, country_code },
        reason: body.reason === 2 ? 2 : body.reason === 0 ? 0 : 1,
      };
    } else if (action === 'signup' || action === 'reset') {
      path = action === 'signup' ? 'auth/signup' : 'auth/setPassword';
      payload = {
        auth_id,
        country_code,
        otp: textValue(body.otp),
        password: textValue(body.password),
      };
    } else {
      if (
        typeof body.value !== 'string' ||
        !body.value ||
        body.value.length > 1024
      )
        return json({ message: 'Enter your password or OTP.' }, 400);
      payload = {
        auth_id,
        country_code,
        data: { via: body.via === 0 ? 0 : 1, value: body.value },
      };
    }
    const r = await upstream(path, '', 'POST', payload);
    if (action === 'login' && r.ok && typeof r.data.access_token === 'string') {
      const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
      const maxAge = Math.min(
        Math.max(Number(r.data.expires_in) || 3600, 1),
        86400,
      );
      return json({ signedIn: true }, 200, {
        'Set-Cookie': `${COOKIE}=${encodeURIComponent(r.data.access_token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`,
      });
    }
    return json(r.data, r.status);
  } catch {
    return json(
      {
        message:
          'Could not reach Microtek. Check your connection and try again.',
      },
      502,
    );
  }
}
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return json({ message: 'Invalid origin.' }, 403);
  const token = session(req);
  if (token) await upstream('auth/logout', token, 'POST', {}).catch(() => null);
  return json({ signedIn: false }, 200, {
    'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  });
}
