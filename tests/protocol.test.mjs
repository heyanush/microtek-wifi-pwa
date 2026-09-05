import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeThing,
  commandPayload,
  validateCommand,
  faults,
} from '../lib/protocol.ts';
import {
  privateIPv4,
  encryptLan,
  decryptLan,
  directRequest,
} from '../bridge/protocol.mjs';
import { signMqtt } from '../lib/cloud-server.ts';
test('Android string fields normalize without losing reported state', () => {
  const t = normalizeThing({
    id: 'a1',
    user_config: '{"name":"Study","uat":"private"}',
    stack: '{"wifi":{"ssid":"device"}}',
    state: '{"involt":231,"load":0}',
    connected: true,
    state_ts: 100,
    ownership: 0,
  });
  assert.equal(t.name, 'Study');
  assert.equal(t.state.load, 0);
  assert.equal(t.userConfig.uat, 'private');
  assert.equal(t.stack.wifi.ssid, 'device');
  assert.equal(t.connected, true);
});
test('missing telemetry stays missing and malformed JSON is contained', () => {
  const t = normalizeThing({ id: 'x', state: 'oops' });
  assert.equal(t.state.batvolt, undefined);
  assert.deepEqual(t.state, {});
});
test('commands match the Android AWS shadow format', () => {
  assert.deepEqual(commandPayload({ ups: 1 }), {
    state: { desired: { ups: 1, src: 'anmq' } },
  });
  for (const c of [
    { ups: 2 },
    { involt: 230 },
    { pow: 1, buzz: 1 },
    null,
    {},
    'abc',
  ])
    assert.throws(() => validateCommand(c));
});
test('fault reporting preserves overloaded numeric codes', () => {
  assert.deepEqual(
    faults({ overload_flt: 130, lowbatwarn: 1, cbtripwarn: 0 }),
    ['Low battery', 'Overload'],
  );
});
test('bridge permits only private IPv4 targets', () => {
  for (const ip of ['192.168.4.1', '10.0.0.2', '172.16.1.1', '172.31.255.2'])
    assert.equal(privateIPv4(ip), true);
  for (const ip of [
    '127.0.0.1',
    '169.254.169.254',
    '8.8.8.8',
    '172.32.0.1',
    '192.168.999.1',
    '192.168.1.1/path',
    'localhost',
  ])
    assert.equal(privateIPv4(ip), false);
});
test('LAN encryption follows Android IV-prefix convention', () => {
  const payload = {
    type: 1,
    uat: 'test-token',
    state: { desired: { ups: 1, src: 'anlan' } },
  };
  const encoded = encryptLan(payload, 'test-password', Buffer.alloc(16, 7));
  assert.deepEqual(decryptLan(encoded, 'test-password'), payload);
  assert.throws(() => decryptLan('invalid', 'test'));
  assert.throws(() => decryptLan(encoded, 'wrong-password'));
});
test('direct status uses /gds and percent-encodes UAT', async () => {
  let called = false;
  const r = await directRequest(
    { ip: '192.168.4.1', uat: 'a+b&c' },
    async (url, options) => {
      called = true;
      assert.equal(url.pathname, '/gds');
      assert.equal(url.searchParams.get('uat'), 'a+b&c');
      assert.equal(options.redirect, 'error');
      assert.equal(options.method, 'GET');
      return new Response('{"involt":230}');
    },
  );
  assert.equal(called, true);
  assert.equal(r.involt, 230);
});
test('direct commands use /sds and include device UAT', async () => {
  await directRequest(
    { ip: '192.168.4.1', uat: 'test', command: { buzz: 0 } },
    async (url, options) => {
      assert.equal(url.pathname, '/sds');
      assert.deepEqual(JSON.parse(options.body), { buzz: 0, uat: 'test' });
      return new Response('OK');
    },
  );
  await assert.rejects(() => directRequest({ ip: '8.8.8.8', uat: 'test' }));
  await assert.rejects(() =>
    directRequest(
      { ip: '192.168.4.1', uat: 'test' },
      async () => new Response('no', { status: 403 }),
    ),
  );
});
test('MQTT signer uses scoped AWS IoT WSS credentials', () => {
  const url = new URL(
    signMqtt(
      {
        broker: 'example-ats.iot.ap-south-1.amazonaws.com',
        accessKey: 'TESTKEY',
        secretKey: 'test-secret',
      },
      new Date('2026-09-05T12:00:00Z'),
    ),
  );
  assert.equal(url.protocol, 'wss:');
  assert.equal(url.pathname, '/mqtt');
  assert.equal(
    url.searchParams.get('X-Amz-Credential'),
    'TESTKEY/20260905/ap-south-1/iotdevicegateway/aws4_request',
  );
  assert.equal(url.searchParams.get('X-Amz-Date'), '20260905T120000Z');
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
  assert.throws(() =>
    signMqtt({ broker: 'attacker.example', accessKey: 'a', secretKey: 'b' }),
  );
});
