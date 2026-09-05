import type { Thing, State } from './protocol';
export function epochMs(value: number): number {
  return Number.isFinite(value) && value > 0
    ? value < 1e12
      ? value * 1000
      : value
    : 0;
}
export function applyReport(
  thing: Thing,
  report: State,
  timestamp: number,
  connected = true,
): Thing {
  const ts = epochMs(timestamp);
  if (ts && ts < epochMs(thing.stateTs)) return thing;
  return { ...thing, state: report, stateTs: ts || Date.now(), connected };
}
export function mergeCloudThings(
  previous: Thing[],
  incoming: Thing[],
): Thing[] {
  return incoming.map((next) => {
    const current = previous.find((t) => t.id === next.id);
    return current && epochMs(current.stateTs) > epochMs(next.stateTs)
      ? {
          ...next,
          state: current.state,
          stateTs: current.stateTs,
          connected: current.connected,
        }
      : next;
  });
}
export interface RefreshClient {
  connected: boolean;
  publishAsync(
    topic: string,
    payload: string,
    options: { qos: 1 },
  ): Promise<unknown>;
}
// MqttClientManager.forceSync: this asks for telemetry; it does not alter settings.
export async function requestDeviceReport(
  client: RefreshClient,
  deviceId: string,
) {
  if (!client.connected)
    throw Error(
      'Live device connection is unavailable. Only the saved cloud report can be retrieved.',
    );
  if (!/^[A-Za-z0-9_-]+$/.test(deviceId)) throw Error('Invalid device ID.');
  await client.publishAsync(
    `things/${deviceId}/control`,
    JSON.stringify({ fpsh: 1 }),
    { qos: 1 },
  );
}
