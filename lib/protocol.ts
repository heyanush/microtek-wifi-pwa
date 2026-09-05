export function textValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}
function looksLikeId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value) || /^[0-9a-f]{10,}$/i.test(value);
}
export type State = Record<string, number | string>;
export type Thing = {
  id: string;
  name: string;
  model: string;
  connected: boolean;
  state: State;
  stateTs: number;
  ownership: number;
  userConfig: Record<string, unknown>;
  stack: Record<string, unknown>;
};
export function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return object(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function normalizeThing(raw: Record<string, unknown>): Thing {
  const config = object(raw.user_config ?? raw.userConfig ?? raw.user_config_json);
  const name = textValue(
    config.name ?? config.display_name ?? config.displayName ?? config.thing_name ?? raw.name ?? raw.display_name ?? raw.displayName ?? raw.thing_name ?? raw.device_name,
  );
  const model = textValue(raw.model_name ?? raw.modelName ?? raw.model_code ?? raw.model ?? config.model_name ?? config.modelName ?? config.model ?? config.model_code);
  return {
    id: textValue(raw.id),
    name: name && !looksLikeId(name) ? name : (model && !looksLikeId(model) ? model : 'Microtek inverter'),
    model: model || 'Microtek inverter',
    connected: raw.connected === true,
    state: object(raw.state) as State,
    stateTs: Number(raw.state_ts) || 0,
    ownership: Number(raw.ownership),
    userConfig: config,
    stack: object(raw.stack),
  };
}
export const settings = [
  ['pow', 'Front switch', 'Enable inverter output'],
  ['ups', 'UPS mode', 'Select the narrower input voltage range'],
  ['buzz', 'Buzzer', 'Audible device alerts'],
  ['vacation', 'Vacation mode', 'Reduce activity while you are away'],
  ['turbochrgsts', 'Turbo charging', 'Enable faster charging'],
  ['highpwr', 'High power', 'Enable high power operation'],
  ['mainscut', 'Force mains cut', 'Switch from mains to backup'],
] as const;
export function validateCommand(command: unknown): State {
  const c = object(command);
  const keys = Object.keys(c);
  if (keys.length !== 1) throw Error('Send one setting at a time.');
  const k = keys[0];
  if (!settings.some(([key]) => key === k) || (c[k] !== 0 && c[k] !== 1))
    throw Error('Unsupported setting or value.');
  return { [k]: Number(c[k]) };
}
export const modes: Record<string, string> = {
  '0': 'Powered on',
  '1': 'Standby',
  '2': 'Mains power',
  '3': 'Battery backup',
  '4': 'Fault',
};
export const faultLabels: Record<string, string> = {
  cbtripwarn: 'MCB tripped',
  wlevelwarn: 'Battery water level low',
  lowbatwarn: 'Low battery',
  chrgrelay_flt: 'Charging relay fault',
  outvolt_flt: 'Output voltage fault',
  batvolt_flt: 'Battery voltage fault',
  backfeed_flt: 'Backfeed detected',
  transF_temp_flt: 'Transformer temperature high',
  mosfet_temp_flt: 'MOSFET temperature high',
  shrtckt_flt: 'Short circuit',
  overload_flt: 'Overload',
};
export function faults(state: State) {
  return Object.entries(faultLabels)
    .filter(([key]) => Number(state[key]) > 0)
    .map(([, label]) => label);
}
export function commandPayload(command: unknown) {
  return { state: { desired: { ...validateCommand(command), src: 'anmq' } } };
}
export function timestamp(value: number) {
  return value
    ? new Date(value < 1e12 ? value * 1000 : value).toLocaleString()
    : 'Not reported';
}

const readingKeys = new Set([
  'mode',
  'model',
  'i_fv',
  'm_name',
  'involt',
  'outvolt',
  'frequency',
  'mains',
  'battype',
  'bkptime',
  'chrgtime',
  'chrgcurr',
  'dischrgcurr',
  'chrgcurrset',
  'chrgsts',
  'batvolt',
  'batcolor',
  'load',
  'rssi',
  'cmd_type',
  'temp',
  'total_conumption',
  'daily_conumption',
  'pv_vol',
  'pv_curr',
  'co2',
  'savings',
  ...settings.map(([key]) => key),
  ...Object.keys(faultLabels),
]);
export function safeSnapshot(thing: Thing): Thing {
  return {
    ...thing,
    userConfig: {},
    stack: {},
    connected: false,
    state: Object.fromEntries(
      Object.entries(thing.state).filter(
        ([key, value]) =>
          readingKeys.has(key) &&
          (typeof value === 'string' || typeof value === 'number'),
      ),
    ),
  };
}
