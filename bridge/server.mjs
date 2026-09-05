import http from 'node:http';
import dgram from 'node:dgram';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  privateIPv4,
  validateCommand,
  directRequest,
  encryptLan,
  decryptLan,
} from './protocol.mjs';
const port = Number(process.env.BRIDGE_PORT || 8788),
  apiKey = process.env.BRIDGE_KEY || randomBytes(24).toString('hex');
const allowed = new Set(
  (
    process.env.PWA_ORIGINS ||
    'http://localhost:3000,https://heyanush.github.io'
  ).split(','),
);
const udp = dgram.createSocket('udp4'),
  packets = new Map();
let udpAvailable = false;
udp.on('error', () => {
  udpAvailable = false;
});
udp.on('message', (data, info) => {
  if (data.length > 4096 || !privateIPv4(info.address)) return;
  const m = data.toString().match(/^\([^|]*\|([^|]+)\|([^)]*)\)/);
  if (m) {
    if (packets.size > 100) packets.clear();
    packets.set(info.address, { mac: m[1], data: m[2], ts: Date.now() });
  }
});
udp.bind(15951, '0.0.0.0', () => {
  udpAvailable = true;
});
function authorize(req) {
  const supplied = Buffer.from(req.headers['x-bridge-key'] || '');
  const expected = Buffer.from(apiKey);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (origin && allowed.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'content-type,x-bridge-key';
    headers['Access-Control-Allow-Methods'] = 'POST,OPTIONS';
    headers['Access-Control-Allow-Private-Network'] = 'true';
  }
  const send = (status, value) => {
    res.writeHead(status, headers);
    res.end(JSON.stringify(value));
  };
  if (origin && !allowed.has(origin))
    return send(403, {
      message: 'Origin is not allowed. Set PWA_ORIGINS for your PWA address.',
    });
  if (
    !['localhost', '127.0.0.1'].includes((req.headers.host || '').split(':')[0])
  )
    return send(403, { message: 'Invalid host.' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    return res.end();
  }
  if (!authorize(req))
    return send(401, {
      message: 'Enter the bridge pairing key printed in your terminal.',
    });
  if (req.method !== 'POST') return send(405, { message: 'Use POST.' });
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 16384)
        return send(413, { message: 'Request too large.' });
    }
    const body = JSON.parse(raw || '{}');
    if (req.url === '/health') return send(200, { ready: true, udpAvailable });
    if (!privateIPv4(body.ip))
      return send(400, { message: 'Enter a private IPv4 inverter address.' });
    if (req.url === '/state' || req.url === '/command') {
      if (req.url === '/command') validateCommand(body.command);
      else delete body.command;
      return send(200, await directRequest(body));
    }
    if (req.url === '/lan/state') {
      const packet = packets.get(body.ip);
      if (!packet)
        return send(404, {
          message:
            'No LAN broadcast received yet. Check the device IP and Wi-Fi network.',
        });
      if (typeof body.password !== 'string' || !body.password)
        throw Error('Device Wi-Fi password required.');
      return send(200, {
        report: decryptLan(packet.data, body.password),
        receivedAt: packet.ts,
      });
    }
    if (req.url === '/lan/command') {
      if (!udpAvailable) throw Error('LAN UDP port is unavailable.');
      validateCommand(body.command);
      if (
        typeof body.uat !== 'string' ||
        !body.uat ||
        typeof body.password !== 'string' ||
        !body.password
      )
        throw Error('Device access token and Wi-Fi password are required.');
      const packet = Buffer.from(
        encryptLan(
          {
            type: 1,
            uat: body.uat,
            state: { desired: { ...body.command, src: 'anlan' } },
          },
          body.password,
        ),
      );
      for (let i = 0; i < 25; i++) {
        await new Promise((resolve, reject) =>
          udp.send(packet, 15951, body.ip, (e) => (e ? reject(e) : resolve())),
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return send(200, { message: 'Command sent. Waiting for device report.' });
    }
    return send(404, { message: 'Unknown bridge operation.' });
  } catch (e) {
    return send(502, {
      message: e instanceof Error ? e.message : 'Could not reach inverter.',
    });
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(
    `Microtek local bridge: http://127.0.0.1:${port}\nPairing key: ${apiKey}\nKeep this terminal open. Connect this computer to the inverter Wi-Fi or its LAN.\nThe key grants local device access; do not share it.`,
  );
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    server.close();
    udp.close();
    process.exit(0);
  });
