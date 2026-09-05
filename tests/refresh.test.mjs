import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReport,
  mergeCloudThings,
  requestDeviceReport,
  epochMs,
} from '../lib/refresh.ts';
import { normalizeThing } from '../lib/protocol.ts';
test('refresh requests the original Android force-push packet', async () => {
  let sent;
  await requestDeviceReport(
    { connected: true, publishAsync: async (...args) => (sent = args) },
    'device123',
  );
  assert.deepEqual(sent, [
    'things/device123/control',
    '{"fpsh":1}',
    { qos: 1 },
  ]);
  await assert.rejects(() =>
    requestDeviceReport(
      { connected: false, publishAsync: async () => assert.fail() },
      'device123',
    ),
  );
});
test('seconds and milliseconds cannot freeze newer reports', () => {
  const old = normalizeThing({
    id: 'a',
    state_ts: 1788600000000,
    state: { load: 10 },
  });
  const fresh = applyReport(old, { load: 20 }, 1788600001);
  assert.equal(fresh.state.load, 20);
  assert.equal(fresh.stateTs, 1788600001000);
  assert.equal(applyReport(fresh, { load: 5 }, 1788599999), fresh);
  assert.equal(epochMs(1788600001), 1788600001000);
});
test('cloud polling cannot overwrite a newer live report', () => {
  const live = normalizeThing({
    id: 'a',
    state_ts: 1788600001000,
    state: { load: 25 },
    connected: true,
  });
  const cached = normalizeThing({
    id: 'a',
    state_ts: 1788600000,
    state: { load: 5 },
    user_config: { name: 'Updated name' },
  });
  const result = mergeCloudThings([live], [cached]);
  assert.equal(result[0].state.load, 25);
  assert.equal(result[0].name, 'Updated name');
  const newer = normalizeThing({
    id: 'a',
    state_ts: 1788600002,
    state: { load: 30 },
  });
  assert.equal(mergeCloudThings(result, [newer])[0].state.load, 30);
});
