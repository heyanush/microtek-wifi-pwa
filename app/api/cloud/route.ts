import { session, sameOrigin, json, upstream } from '@/lib/cloud-server';
const readable =
  /^(?:things|user|user\/homes|user\/notifications|things\/sharedWithMe|things\/sharedByMe|things\/[A-Za-z0-9_-]+(?:\/analytics\/(?:averageLoad|powerCutCount)|\/share)?|user\/homes\/[A-Za-z0-9_-]+\/rooms)$/;
export async function GET(req: Request) {
  const token = session(req);
  if (!token) return json({ message: 'Please sign in.' }, 401);
  const u = new URL(req.url),
    path = u.searchParams.get('path') || '';
  if (!readable.test(path))
    return json({ message: 'Unsupported endpoint.' }, 400);
  const q = new URLSearchParams();
  for (const key of ['home_id', 'start_date', 'end_date'])
    if (u.searchParams.has(key)) q.set(key, u.searchParams.get(key)!);
  try {
    const r = await upstream(path + (q.size ? '?' + q : ''), token);
    return json(r.data, r.status);
  } catch {
    return json({ message: 'Microtek is unavailable. Try again.' }, 502);
  }
}
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ message: 'Invalid origin.' }, 403);
  const token = session(req);
  if (!token) return json({ message: 'Please sign in.' }, 401);
  try {
    const { id, name } = (await req.json()) as { id: string; name: string };
    if (
      !/^[A-Za-z0-9_-]+$/.test(id) ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 80
    )
      return json({ message: 'Enter a device name of 1–80 characters.' }, 400);
    const r = await upstream(`things/${id}/userConfig`, token, 'POST', {
      name: name.trim(),
    });
    return json(r.data, r.status);
  } catch {
    return json({ message: 'Could not save the device name.' }, 502);
  }
}
