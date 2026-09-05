import { textValue } from '@/lib/protocol';
import { session, json, upstream, signMqtt } from '@/lib/cloud-server';
export async function GET(req: Request) {
  const token = session(req);
  if (!token) return json({ message: 'Please sign in.' }, 401);
  try {
    const r = await upstream('config', token);
    if (!r.ok)
      return json(
        { message: 'Microtek messaging configuration is unavailable.' },
        r.status,
      );
    return json({
      url: signMqtt({
        broker: textValue(r.data.broker),
        accessKey: textValue(r.data.accessKey),
        secretKey: textValue(r.data.secretKey),
      }),
      expiresIn: 900,
    });
  } catch {
    return json(
      {
        message:
          'Cloud live connection is unavailable. You can still refresh device status.',
      },
      502,
    );
  }
}
