'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap,
  Wifi,
  ArrowRight,
  RefreshCw,
  LogOut,
  BatteryCharging,
  Activity,
  Sun,
  Plug,
  Settings2,
  Download,
  ShieldCheck,
  TriangleAlert,
  House,
  BookOpen,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { request, cloud, bridge, type Bridge } from '@/lib/client';
import {
  normalizeThing,
  safeSnapshot,
  object,
  textValue,
  settings,
  modes,
  faults,
  timestamp,
  commandPayload,
  type Thing,
  type State,
} from '@/lib/protocol';
import type { MqttClient } from 'mqtt';
import {
  applyReport,
  mergeCloudThings,
  requestDeviceReport,
  epochMs,
} from '@/lib/refresh';
const emptyBridge: Bridge = {
  key: '',
  ip: '192.168.4.1',
  uat: '',
  password: '',
  transport: 'direct',
};
const sample = normalizeThing({
  id: 'demo-inverter',
  model_name: 'LUXE WiFi · Sample inverter',
  connected: true,
  ownership: 0,
  user_config: { name: 'Home inverter' },
  state_ts: Date.now(),
  state: {
    mode: 2,
    involt: 230,
    outvolt: 228,
    frequency: 50,
    load: 24,
    batvolt: 13.4,
    bkptime: 180,
    chrgtime: 45,
    chrgcurr: 12,
    dischrgcurr: 0,
    chrgsts: 2,
    battype: 3,
    pow: 1,
    ups: 1,
    buzz: 1,
    vacation: 0,
    turbochrgsts: 0,
    highpwr: 0,
    mainscut: 0,
    rssi: -52,
    cmd_type: 1,
    pv_vol: 42,
    pv_curr: 6.2,
    daily_conumption: 2.6,
    total_conumption: 384,
    temp: 32,
  },
});
function Brand() {
  return (
    <div className="brand">
      <Zap />
      <strong>
        MICROTEK<span>+ WiFi</span>
      </strong>
    </div>
  );
}
function Metric({
  label,
  value,
  unit,
  icon: Icon,
}: {
  label: string;
  value: string | number | undefined | null;
  unit?: string;
  icon?: typeof Zap;
}) {
  return (
    <article className="metric">
      {Icon && <Icon size={21} />}
      <span>{label}</span>
      <strong>
        {value === undefined || value === null || value === ''
          ? '—'
          : String(value)}{' '}
        <small>{value !== undefined ? unit : ''}</small>
      </strong>
    </article>
  );
}
export default function Home() {
  const [mode, setMode] = useState<
    'login' | 'cloud' | 'local' | 'demo' | 'offline'
  >('login');
  const [things, setThings] = useState<Thing[]>([]),
    [selected, setSelected] = useState(''),
    [homes, setHomes] = useState<{ id: string; name: string }[]>([]),
    [home, setHome] = useState('');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [online, setOnline] = useState(true),
    [mqttLive, setMqttLive] = useState(false),
    [authResolved, setAuthResolved] = useState(false);
  const [auth, setAuth] = useState<'password' | 'otp' | 'signup' | 'reset'>(
      'password',
    ),
    [account, setAccount] = useState(''),
    [country, setCountry] = useState('+91'),
    [value, setValue] = useState(''),
    [otp, setOtp] = useState('');
  const [local, setLocal] = useState<Bridge>(emptyBridge),
    [localOpen, setLocalOpen] = useState(false),
    [pending, setPending] = useState<{
      key: string;
      value: number;
      id: string;
    } | null>(null);
  const [install, setInstall] = useState<
      (Event & { prompt: () => Promise<void> }) | null
    >(null),
    [tab, setTab] = useState('status'),
    [rename, setRename] = useState('');
  const mqtt = useRef<MqttClient | null>(null),
    generation = useRef(0),
    thingsRef = useRef(things),
    pendingRef = useRef(pending);
  useEffect(() => {
    thingsRef.current = things;
  }, [things]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const thing = things.find((t) => t.id === selected) || things[0],
    state = thing?.state || {};
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const ctx = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!ctx?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        ctx.registerTool(
          {
            name: 'read_inverter_status',
            description:
              'Read the inverter readings currently displayed. Does not refresh or control devices.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: (input: unknown) => {
              if (
                input === null ||
                typeof input !== 'object' ||
                Object.keys(input).length
              )
                throw Error('Expected an empty object.');
              return thingsRef.current.map(
                ({ id, name, state, stateTs, connected }) => ({
                  id,
                  name,
                  state,
                  stateTs,
                  connected,
                }),
              );
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
  const receive = useCallback(
    (id: string, report: State, ts: number, connected = true) => {
      setThings((prev) =>
        prev.map((t) =>
          t.id === id ? applyReport(t, report, ts, connected) : t,
        ),
      );
      const p = pendingRef.current;
      if (p?.id === id && Number(report[p.key]) === p.value) {
        setPending(null);
        setMessage('Setting confirmed by inverter.');
      }
    },
    [],
  );
  const loadThings = async (homeId = home) => {
    const result = await cloud('things', homeId ? { home_id: homeId } : {});
    const list = (Array.isArray(result.things) ? result.things : []).map(
      normalizeThing,
    );
    setThings((previous) => mergeCloudThings(previous, list));
    setSelected((s) =>
      list.some((t: Thing) => t.id === s) ? s : list[0]?.id || '',
    );
  };
  const enterCloud = async () => {
    const result = await cloud('user/homes');
    const list = (Array.isArray(result.homes) ? result.homes : []).map((raw) => {
      const h = raw as Record<string, unknown>;
      const id = textValue(h.id ?? h.home_id ?? h.homeId);
      const label = textValue(h.name ?? h.home_name ?? h.homeName ?? h.title);
      return { id, name: label && !/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(label) ? label : 'My home', is_default: h.is_default === true || h.isDefault === true };
    });
    setHomes(list);
    const first = list.find((h) => h.is_default) || list[0];
    setHome(first?.id || '');
    await loadThings(first?.id || '');
    setMode('cloud');
  };
  useEffect(() => {
    queueMicrotask(() => setOnline(navigator.onLine));
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    const prompt = (event: Event) => {
      event.preventDefault();
      setInstall(event as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener('beforeinstallprompt', prompt);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production')
      navigator.serviceWorker
        .register(new URL('sw.js', document.baseURI).pathname)
        .catch(() =>
          setMessage('Offline installation is unavailable in this browser.'),
        );
    void request('/api/session')
      .then(async (r) => {
        if (r.signedIn) await run(enterCloud);
      })
      .catch(() => {})
      .finally(() => setAuthResolved(true));
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
      window.removeEventListener('beforeinstallprompt', prompt);
    };
  }, []);
  useEffect(() => {
    if ((mode === 'cloud' || mode === 'local') && things.length) {
      try {
        localStorage.setItem(
          'microtek.snapshot',
          JSON.stringify(things.map(safeSnapshot)),
        );
      } catch {
        /* Storage can be disabled. */
      }
    }
  }, [things, mode]);
  useEffect(() => {
    if (!pending) return;
    const timeout = setTimeout(() => {
      setPending(null);
      setError(
        'The inverter has not confirmed this setting. Refresh its status before trying again.',
      );
    }, 15000);
    return () => clearTimeout(timeout);
  }, [pending]);
  useEffect(() => {
    if (mode !== 'cloud' || !online) return;
    let stopped = false,
      timer: number | undefined;
    const gen = ++generation.current;
    let ownedClient: MqttClient | null = null;
    async function connect() {
      try {
        const [{ url }, module] = await Promise.all([
          request<{ url: string }>('/api/mqtt'),
          import('mqtt'),
        ]);
        if (stopped || gen !== generation.current) return;
        const connect = module.connect ?? module.default?.connect;
        if (typeof connect !== 'function')
          throw Error('The live messaging client could not load.');
        const client = connect(url, {
          clientId: 'app-' + crypto.randomUUID(),
          protocolVersion: 4,
          clean: true,
          reconnectPeriod: 0,
          connectTimeout: 15000,
          keepalive: 120,
        });
        mqtt.current = client;
        ownedClient = client;
        client.on('connect', () => {
          void (async () => {
            try {
              const ids = thingsRef.current.map((t) => t.id);
              const topics = [
                ...(home ? [`home/${home}/+/+/state/reported`] : []),
                ...ids.flatMap((id) => [
                  `home/+/things/${id}/state/reported`,
                  `$aws/events/presence/+/${id}`,
                ]),
              ];
              if (!topics.length) return;
              const grants = await client.subscribeAsync(topics, { qos: 0 });
              if (grants.some((grant) => Number(grant.qos) === 128))
                throw Error('Microtek rejected a device report subscription.');
              if (stopped) return;
              setMqttLive(true);
              await Promise.all(
                ids.map((id) => requestDeviceReport(client, id)),
              );
            } catch (e) {
              if (!stopped) {
                setMqttLive(false);
                setError(
                  e instanceof Error
                    ? e.message
                    : 'Could not subscribe to device reports.',
                );
              }
            }
          })();
        });
        client.on('message', (topic, bytes) => {
          try {
            const data = JSON.parse(bytes.toString());
            if (topic.startsWith('$aws/events/presence/')) {
              const id = topic.split('/').at(-1);
              setThings((prev) =>
                prev.map((t) =>
                  t.id === id
                    ? {
                        ...t,
                        connected:
                          data.eventType === 'connected' ||
                          topic.includes('/connected/'),
                      }
                    : t,
                ),
              );
            } else if ((data.type || 0) === 0) {
              receive(topic.split('/')[3], data, Number(data.ts) || Date.now());
            }
          } catch {
            /* Ignore malformed broadcasts. */
          }
        });
        client.on('error', () =>
          setMessage(
            'Live messaging is unavailable. Refresh to retrieve the latest cloud report.',
          ),
        );
        client.on('close', () => {
          setMqttLive(false);
          if (!stopped) timer = window.setTimeout(connect, 10000);
        });
      } catch (e) {
        if (stopped) return;
        setError(
          e instanceof Error
            ? e.message
            : 'Cloud live connection could not be established.',
        );
        setMqttLive(false);
        if (!stopped) timer = window.setTimeout(connect, 30000);
      }
    }
    void connect();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      ownedClient?.end(true);
      setMqttLive(false);
    };
  }, [mode, home, online, receive]);
  useEffect(() => {
    if (mode !== 'cloud' || !online) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    async function poll() {
      if (inFlight || stopped || document.hidden) return;
      inFlight = true;
      try {
        const result = await cloud('things', home ? { home_id: home } : {});
        if (!stopped && Array.isArray(result.things)) {
          const incoming = result.things.map(normalizeThing);
          setThings((previous) => mergeCloudThings(previous, incoming));
        }
      } catch (e) {
        if (!stopped)
          setMessage(
            e instanceof Error ? e.message : 'Automatic cloud refresh failed.',
          );
      } finally {
        inFlight = false;
      }
    }
    const tick = async () => {
      await poll();
      if (!stopped) timer = setTimeout(tick, 15000);
    };
    const visible = () => {
      if (!document.hidden) void poll();
    };
    timer = setTimeout(tick, 15000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [mode, home, online]);
  const refreshLocal = useCallback(
    async (
      config = local,
      target = thing,
      isCurrent: () => boolean = () => true,
    ) => {
      const result = await bridge(config);
      if (!isCurrent()) return;
      const report = object(
        config.transport === 'lan' ? result.report : result,
      ) as State;
      const ts =
        config.transport === 'lan' ? Number(result.receivedAt) : Date.now();
      if (
        !Object.keys(report).some((k) =>
          ['mode', 'involt', 'batvolt', 'pow', 'udid'].includes(k),
        )
      )
        throw Error(
          'The inverter did not return a valid state report. Check its access token.',
        );
      const id = target?.id || String(report.udid || 'local-inverter');
      if (target) receive(id, report, ts, Date.now() - ts < 15000);
      else {
        setThings([
          {
            ...normalizeThing({
              id,
              model_name: report.m_name || 'Local inverter',
              state: report,
              ownership: 0,
              connected: true,
              state_ts: ts,
            }),
            name: 'Local inverter',
          },
        ]);
        setSelected(id);
      }
    },
    [local, thing, receive],
  );
  useEffect(() => {
    if (mode !== 'local') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refreshLocal(local, thing, () => !cancelled);
      } catch (e) {
        if (!cancelled) {
          setThings((p) => p.map((t) => ({ ...t, connected: false })));
          setError(e instanceof Error ? e.message : 'Local connection lost.');
        }
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, refreshLocal, local, thing]);
  const refresh = () =>
    run(async () => {
      if (mode === 'local') await refreshLocal();
      else if (mode === 'cloud') {
        const target = thing;
        if (!target) {
          await loadThings();
          return;
        }
        const previousTs = epochMs(target.stateTs);
        const client = mqtt.current;
        if (!client?.connected || !mqttLive) {
          await loadThings();
          setMessage(
            'Loaded the saved cloud report. Live device messaging is unavailable; these readings may be old.',
          );
          return;
        }
        await requestDeviceReport(client, target.id);
        setMessage('Requested a fresh report from the inverter…');
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (
            epochMs(
              thingsRef.current.find((t) => t.id === target.id)?.stateTs || 0,
            ) > previousTs
          ) {
            setMessage('Fresh device report received.');
            return;
          }
        }
        await loadThings();
        setMessage(
          'The inverter has not sent a new report yet. Showing the latest available cloud readings.',
        );
      } else if (mode === 'demo')
        setMessage('Sample readings are for exploring the app.');
    });
  async function change(key: string, on: boolean) {
    if (!thing) return;
    setError('');
    setMessage('');
    const command = { [key]: on ? 1 : 0 };
    if (mode === 'demo') {
      receive(thing.id, { ...state, ...command }, Date.now());
      setMessage('Sample setting updated. No device was controlled.');
      return;
    }
    try {
      if (pending)
        throw Error('Wait for the previous setting to be confirmed.');
      setPending({ key, value: on ? 1 : 0, id: thing.id });
      if (mode === 'local') await bridge(local, command);
      else {
        if (!mqtt.current?.connected)
          throw Error('Connect to live messaging before changing settings.');
        await mqtt.current.publishAsync(
          `$aws/things/${thing.id}/shadow/update`,
          JSON.stringify(commandPayload(command)),
          { qos: 1 },
        );
      }
      setMessage('Command sent. Waiting for the inverter to confirm.');
    } catch (e) {
      setPending(null);
      setError(e instanceof Error ? e.message : 'Command failed.');
    }
  }
  async function signOut() {
    await run(async () => {
      if (mode === 'cloud') await request('/api/session', { method: 'DELETE' });
      mqtt.current?.end(true);
      setMode('login');
      setThings([]);
      setLocal(emptyBridge);
      setPending(null);
      localStorage.removeItem('microtek.snapshot');
      setValue('');
      setOtp('');
    });
  }
  const openLocal = () => {
    if (thing) {
      setLocal((c) => ({
        ...c,
        uat:
          typeof thing.userConfig.uat === 'string'
            ? thing.userConfig.uat
            : c.uat,
        password: textValue(object(thing.stack.wifi).password) || c.password,
      }));
    }
    setLocalOpen(true);
  };
  const localForm = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await refreshLocal(local, mode === 'cloud' ? thing : undefined);
          setMode('local');
          setLocalOpen(false);
          setMessage('Connected through your local bridge.');
        });
      }}
    >
      <p>
        Run the local bridge on this computer, then connect the computer to the
        inverter’s Wi-Fi or home network.
      </p>
      <label htmlFor="local-transport">
        Connection
        <Select
          value={local.transport}
          onValueChange={(v) =>
            setLocal({ ...local, transport: v as Bridge['transport'] })
          }
        >
          <SelectTrigger id="local-transport">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="direct">Inverter Wi-Fi (HTTP)</SelectItem>
            <SelectItem value="lan">Home network (encrypted LAN)</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label>
        Bridge pairing key
        <input
          type="password"
          required
          value={local.key}
          onChange={(e) => setLocal({ ...local, key: e.target.value })}
          autoComplete="off"
        />
      </label>
      <label>
        Inverter IP address
        <input
          required
          value={local.ip}
          onChange={(e) => setLocal({ ...local, ip: e.target.value })}
        />
      </label>
      <label>
        Device access token (UAT)
        <input
          type="password"
          required
          value={local.uat}
          onChange={(e) => setLocal({ ...local, uat: e.target.value })}
          autoComplete="off"
        />
      </label>
      {local.transport === 'lan' && (
        <label>
          Device Wi-Fi password
          <input
            type="password"
            required
            value={local.password}
            onChange={(e) => setLocal({ ...local, password: e.target.value })}
            autoComplete="off"
          />
        </label>
      )}
      <button className="primary" disabled={busy}>
        {busy ? 'Connecting…' : 'Connect locally'}
        <Wifi size={18} />
      </button>
      <p className="small">
        Sign in first and choose a device to fill its access token
        automatically. The bridge must run on the same computer as this browser.
      </p>
    </form>
  );
  const notices = (
    <>
      {!online && (
        <div className="notice warning">
          <Wifi size={18} />
          Offline — cloud controls are unavailable. Local bridge access may
          still work.
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          <TriangleAlert size={18} />
          {error}
        </div>
      )}
      {message && <output className="notice">{message}</output>}
    </>
  );
  if (!authResolved)
    return <main className="entry boot-screen"><Brand /><section className="boot-card"><div className="boot-mark"><Zap /></div><strong>Restoring your inverter view</strong><p>Checking your saved Microtek session…</p><span className="boot-loader" /></section></main>;
  if (mode === 'login')
    return (
      <main className="entry">
        <Brand />
        <section className="login">
          <div className="eyebrow">YOUR POWER. CONNECTED.</div>
          <h1>Welcome home.</h1>
          <p>
            Connect to your inverter to see your power, battery and backup
            status.
          </p>
          {notices}
          <Tabs defaultValue="cloud">
            <TabsList className="connection-tabs">
              <TabsTrigger value="cloud">Cloud account</TabsTrigger>
              <TabsTrigger value="local">Direct Wi-Fi</TabsTrigger>
            </TabsList>
            <TabsContent value="cloud">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    if (auth === 'signup' || auth === 'reset') {
                      await request('/api/session', {
                        method: 'POST',
                        body: JSON.stringify({
                          action: auth,
                          auth_id: account,
                          country_code: country,
                          otp,
                          password: value,
                        }),
                      });
                      setAuth('password');
                      setMessage(
                        auth === 'signup'
                          ? 'Account created. Sign in with your password.'
                          : 'Password updated. Sign in again.',
                      );
                      setValue('');
                      setOtp('');
                    } else {
                      await request('/api/session', {
                        method: 'POST',
                        body: JSON.stringify({
                          action: 'login',
                          auth_id: account,
                          country_code: country,
                          value,
                          via: auth === 'otp' ? 0 : 1,
                        }),
                      });
                      setValue('');
                      await enterCloud();
                    }
                  });
                }}
              >
                <label>
                  Mobile number or email
                  <input
                    required
                    autoComplete="username"
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                  />
                </label>
                <label>
                  Country code
                  <input
                    required
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    inputMode="tel"
                  />
                </label>
                <label>
                  {auth === 'otp'
                    ? 'One-time password'
                    : auth === 'signup' || auth === 'reset'
                      ? 'New password'
                      : 'Password'}
                  <input
                    required
                    type={auth === 'otp' ? 'text' : 'password'}
                    autoComplete={
                      auth === 'otp'
                        ? 'one-time-code'
                        : auth === 'password'
                          ? 'current-password'
                          : 'new-password'
                    }
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </label>
                {(auth === 'signup' || auth === 'reset') && (
                  <label>
                    Verification code
                    <input
                      required
                      autoComplete="one-time-code"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                    />
                  </label>
                )}
                {auth !== 'password' && (
                  <button
                    type="button"
                    className="secondary wide"
                    disabled={busy || !account}
                    onClick={() =>
                      void run(async () => {
                        await request('/api/session', {
                          method: 'POST',
                          body: JSON.stringify({
                            action: 'otp',
                            auth_id: account,
                            country_code: country,
                            reason:
                              auth === 'signup' ? 0 : auth === 'reset' ? 2 : 1,
                          }),
                        });
                        setMessage(
                          'Verification code requested. Check your mobile or email.',
                        );
                      })
                    }
                  >
                    Send verification code
                  </button>
                )}
                <button className="primary" disabled={busy}>
                  {busy
                    ? 'Please wait…'
                    : auth === 'signup'
                      ? 'Create account'
                      : auth === 'reset'
                        ? 'Reset password'
                        : 'Sign in'}
                  <ArrowRight size={18} />
                </button>
              </form>
              <div className="auth-links">
                {(['password', 'otp', 'signup', 'reset'] as const)
                  .filter((a) => a !== auth)
                  .map((a) => (
                    <button
                      key={a}
                      onClick={() => {
                        setAuth(a);
                        setValue('');
                        setError('');
                        setMessage('');
                      }}
                    >
                      {
                        {
                          password: 'Use password',
                          otp: 'Use OTP',
                          signup: 'Create account',
                          reset: 'Forgot password?',
                        }[a]
                      }
                    </button>
                  ))}
              </div>
            </TabsContent>
            <TabsContent value="local">{localForm}</TabsContent>
          </Tabs>
          <div className="divider" />
          <button
            className="secondary wide"
            onClick={() => {
              setThings([sample]);
              setSelected(sample.id);
              setMode('demo');
              setError('');
              setMessage('');
            }}
          >
            Explore with sample readings
          </button>
          <button
            className="text-button"
            onClick={() => {
              try {
                const data = JSON.parse(
                  localStorage.getItem('microtek.snapshot') || '[]',
                );
                if (!Array.isArray(data) || !data.length) throw Error();
                setThings(data);
                setSelected(data[0].id);
                setMode('offline');
                setError('');
              } catch {
                setError(
                  'No saved readings yet. Connect to an inverter first.',
                );
              }
            }}
          >
            View saved offline readings
          </button>
          <footer>
            <ShieldCheck size={16} /> Your existing Microtek account and
            devices.
          </footer>
        </section>
      </main>
    );
  const controlEnabled =
    mode === 'demo' ||
    (mode === 'local' && thing?.connected) ||
    (mode === 'cloud' &&
      online &&
      mqttLive &&
      thing?.connected &&
      thing.ownership !== 2);
  return (
    <div className="workspace">
      <header className="topbar">
        <Brand />
        <div className="header-actions">
          {install && (
            <button
              className="secondary"
              onClick={async () => {
                await install.prompt();
                setInstall(null);
              }}
            >
              <Download size={16} />
              Install
            </button>
          )}
          <button
            className="secondary"
            onClick={() => void signOut()}
            disabled={busy}
          >
            <LogOut size={16} />
            <span>{mode === 'cloud' ? 'Sign out' : 'Exit'}</span>
          </button>
        </div>
      </header>
      <main className="dashboard">
        <div className="page-heading">
          <div>
            <div className="eyebrow">POWER AT A GLANCE</div>
            <h1>Your inverter</h1>
          </div>
          <div className={'connection ' + (mode === 'demo' ? 'sample' : '')}>
            <span
              className={mqttLive || mode === 'local' ? 'dot live' : 'dot'}
            />
            {mode === 'demo'
              ? 'Sample readings'
              : mode === 'offline'
                ? 'Saved readings'
                : mode === 'local'
                  ? 'Local bridge'
                  : mqttLive
                    ? 'Cloud · live'
                    : 'Cloud · last report'}
          </div>
        </div>
        {notices}
        {mode === 'demo' && (
          <div className="notice">
            Demo mode. All readings and controls are simulated.{' '}
            <button className="text-button" onClick={() => void signOut()}>
              Connect your inverter <ArrowRight size={16} />
            </button>
          </div>
        )}
        {mode === 'offline' && (
          <div className="notice warning">
            Saved readings may be out of date. Sign in or connect locally to get
            a new report.
          </div>
        )}
        <div className="toolbar">
          {homes.length > 0 && mode === 'cloud' && (
            <label className="inline-label" htmlFor="home-select">
              <House size={18} />
              <Select
                value={home}
                onValueChange={(v) =>
                  void run(async () => {
                    setHome(String(v));
                    await loadThings(String(v));
                  })
                }
              >
                <SelectTrigger id="home-select" aria-label="Home">
                  <span className="flex-1 text-left">{homes.find((h) => h.id === home)?.name || 'My home'}</span>
                </SelectTrigger>
                <SelectContent>
                  {homes.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          {things.length > 0 && (
            <label className="inline-label" htmlFor="device-select">
              <Plug size={18} />
              <Select
                value={thing?.id || ''}
                onValueChange={(v) => {
                  setSelected(String(v));
                  setPending(null);
                }}
              >
                <SelectTrigger id="device-select" aria-label="Inverter">
                  <span className="flex-1 text-left">{thing?.name || 'Microtek inverter'}</span>
                </SelectTrigger>
                <SelectContent>
                  {things.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          <button
            className="secondary"
            disabled={busy || mode === 'offline'}
            onClick={refresh}
          >
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
            Refresh
          </button>
          {mode === 'cloud' && (
            <button className="secondary" onClick={openLocal}>
              <Wifi size={16} />
              Use local Wi-Fi
            </button>
          )}
        </div>
        {!thing ? (
          <section className="panel empty">
            <Plug size={36} />
            <h2>No devices in this home</h2>
            <p>
              Choose another home or add your inverter with the Android app,
              then refresh here.
            </p>
          </section>
        ) : (
          <>
            <section className="power-summary">
              <div>
                <div className="eyebrow">{thing.model}</div>
                <h2>{thing.name}</h2>
                <p>
                  {thing.connected
                    ? 'Device reported connected'
                    : 'Device offline or connection unverified'}
                </p>
                <span className="small">
                  Last report: {timestamp(thing.stateTs)}
                </span>
              </div>
              <div className="mode">
                <Plug />
                <span>Power source</span>
                <strong>{modes[String(state.mode)] || 'Not reported'}</strong>
              </div>
            </section>
            {faults(state).length > 0 && (
              <div className="notice error">
                <TriangleAlert />
                {faults(state).join(' · ')}
              </div>
            )}
            <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
              <TabsList className="dashboard-tabs" variant="line">
                <TabsTrigger value="status">
                  <Activity />
                  Status
                </TabsTrigger>
                <TabsTrigger value="battery">
                  <BatteryCharging />
                  Battery
                </TabsTrigger>
                {Number(state.cmd_type) === 1 && (
                  <TabsTrigger value="solar">
                    <Sun />
                    Solar
                  </TabsTrigger>
                )}
                <TabsTrigger value="settings">
                  <Settings2 />
                  Settings
                </TabsTrigger>
                <TabsTrigger value="usage">Usage</TabsTrigger>
              </TabsList>
              <TabsContent value="status">
                <div className="metrics">
                  <Metric
                    label="Mains voltage"
                    value={state.involt}
                    unit="V"
                    icon={Plug}
                  />
                  <Metric
                    label="Output voltage"
                    value={state.outvolt}
                    unit="V"
                    icon={Zap}
                  />
                  <Metric
                    label="Connected load"
                    value={state.load}
                    unit="%"
                    icon={Activity}
                  />
                  <Metric
                    label="Backup time"
                    value={state.bkptime}
                    unit="min"
                    icon={BatteryCharging}
                  />
                </div>
                <div className="two-col">
                  <section className="panel">
                    <h3>Battery overview</h3>
                    <div className="stat-line">
                      <span>Battery voltage</span>
                      <strong>{state.batvolt ?? '—'} V</strong>
                    </div>
                    <div className="stat-line">
                      <span>Charging current</span>
                      <strong>{state.chrgcurr ?? '—'} A</strong>
                    </div>
                    <div className="stat-line">
                      <span>Charging status</span>
                      <strong>
                        {(
                          {
                            '0': 'Not charging',
                            '1': 'Charging (CC)',
                            '2': 'Charging (CV)',
                            '3': 'Charging (float)',
                            '4': 'Fully charged',
                          } as Record<string, string>
                        )[String(state.chrgsts)] || 'Not reported'}
                      </strong>
                    </div>
                  </section>
                  <section className="panel">
                    <h3>Power quality</h3>
                    <div className="stat-line">
                      <span>Mains frequency</span>
                      <strong>{state.frequency ?? '—'} Hz</strong>
                    </div>
                    <div className="stat-line">
                      <span>Wi-Fi signal</span>
                      <strong>{state.rssi ?? '—'} dBm</strong>
                    </div>
                    <div className="stat-line">
                      <span>UPS mode</span>
                      <strong>
                        {state.ups === undefined
                          ? 'Not reported'
                          : Number(state.ups) === 1
                            ? 'Enabled'
                            : 'Disabled'}
                      </strong>
                    </div>
                  </section>
                </div>
              </TabsContent>
              <TabsContent value="battery">
                <div className="metrics">
                  <Metric
                    label="Battery voltage"
                    value={state.batvolt}
                    unit="V"
                    icon={BatteryCharging}
                  />
                  <Metric
                    label="Charging current"
                    value={state.chrgcurr}
                    unit="A"
                  />
                  <Metric
                    label="Discharging current"
                    value={state.dischrgcurr}
                    unit="A"
                  />
                  <Metric
                    label="Time to charge"
                    value={state.chrgtime}
                    unit="min"
                  />
                </div>
                <section className="panel">
                  <h3>Battery information</h3>
                  <div className="stat-line">
                    <span>Battery type</span>
                    <strong>
                      {(
                        {
                          '0': 'Lithium',
                          '1': 'SMF',
                          '2': 'Flat plate',
                          '3': 'Tubular',
                        } as Record<string, string>
                      )[String(state.battype)] || 'Not reported'}
                    </strong>
                  </div>
                  <div className="stat-line">
                    <span>Backup time</span>
                    <strong>{state.bkptime ?? '—'} minutes</strong>
                  </div>
                  <p>
                    Backup and charging times are estimates reported by your
                    inverter.
                  </p>
                </section>
              </TabsContent>
              <TabsContent value="solar">
                <div className="metrics">
                  <Metric
                    label="PV voltage"
                    value={state.pv_vol}
                    unit="V"
                    icon={Sun}
                  />
                  <Metric label="PV current" value={state.pv_curr} unit="A" />
                  <Metric
                    label="Today’s energy"
                    value={state.daily_conumption}
                    unit="kWh"
                  />
                  <Metric
                    label="Total energy"
                    value={state.total_conumption}
                    unit="kWh"
                  />
                </div>
                <section className="panel">
                  <h3>Solar information</h3>
                  <div className="stat-line">
                    <span>Temperature</span>
                    <strong>{state.temp ?? '—'} °C</strong>
                  </div>
                  <div className="stat-line">
                    <span>Reported CO₂ reduction</span>
                    <strong>{state.co2 ?? '—'}</strong>
                  </div>
                  <div className="stat-line">
                    <span>Reported savings</span>
                    <strong>{state.savings ?? '—'}</strong>
                  </div>
                </section>
              </TabsContent>
              <TabsContent value="settings">
                <section className="panel">
                  <h3>Inverter settings</h3>
                  {!controlEnabled && (
                    <p>
                      Connect to your inverter with control access to change
                      settings.
                    </p>
                  )}
                  {settings.map(([key, label, description]) => (
                    <div className="setting" key={key}>
                      <div>
                        <label htmlFor={'setting-' + key}>{label}</label>
                        <p>
                          {state[key] === undefined
                            ? 'Not reported by this model'
                            : description}
                          {pending?.key === key
                            ? ' · Waiting for confirmation…'
                            : ''}
                        </p>
                      </div>
                      <Switch
                        id={'setting-' + key}
                        checked={Number(state[key]) === 1}
                        disabled={
                          !controlEnabled ||
                          !!pending ||
                          state[key] === undefined
                        }
                        onCheckedChange={(on) => void change(key, on)}
                      />
                    </div>
                  ))}
                </section>
                {mode === 'cloud' && (
                  <section className="panel">
                    <h3>Device name</h3>
                    <form
                      className="rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          await request('/api/cloud', {
                            method: 'POST',
                            body: JSON.stringify({
                              id: thing.id,
                              name: rename,
                            }),
                          });
                          await loadThings();
                          setRename('');
                          setMessage('Device name updated.');
                        });
                      }}
                    >
                      <label>
                        New name
                        <input
                          maxLength={80}
                          required
                          value={rename}
                          placeholder={thing.name}
                          onChange={(e) => setRename(e.target.value)}
                        />
                      </label>
                      <button className="secondary" disabled={busy}>
                        Save name
                      </button>
                    </form>
                  </section>
                )}
              </TabsContent>
              <TabsContent value="usage">
                <Usage key={thing.id} id={thing.id} mode={mode} />
              </TabsContent>
            </Tabs>
            <section className="manuals">
              <BookOpen size={18} />
              <span>User manuals</span>
              <a href={new URL('manuals/luxe-wifi.pdf', typeof document === 'undefined' ? 'http://localhost/' : document.baseURI).pathname} target="_blank" rel="noreferrer">
                LUXE WiFi
              </a>
              <a href={new URL('manuals/i-lithium.pdf', typeof document === 'undefined' ? 'http://localhost/' : document.baseURI).pathname} target="_blank" rel="noreferrer">
                i-Lithium
              </a>
            </section>
          </>
        )}
        <footer>
          Microtek+ WiFi · Web edition{' '}
          <span>Readings come from the last device report.</span>
        </footer>
      </main>
      <Dialog open={localOpen} onOpenChange={setLocalOpen}>
        <DialogContent className="local-dialog">
          <DialogHeader>
            <DialogTitle>Connect over local Wi-Fi</DialogTitle>
            <DialogDescription>
              Use your computer as the connection to your inverter.
            </DialogDescription>
          </DialogHeader>
          {localForm}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Usage({ id, mode }: { id: string; mode: string }) {
  const [start, setStart] = useState(() =>
      new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    ),
    [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10)),
    [data, setData] = useState<{
      load?: Record<string, unknown>;
      cuts?: Record<string, unknown>;
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <h3>Usage trends</h3>
      <p>Retrieve daily average load and power-cut counts from Microtek.</p>
      <form
        className="date-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setData(null);
          try {
            if (start > end)
              throw Error('Start date must be before the end date.');
            const [load, cuts] = await Promise.all([
              cloud(`things/${id}/analytics/averageLoad`, {
                start_date: start,
                end_date: end,
              }),
              cloud(`things/${id}/analytics/powerCutCount`, {
                start_date: start,
                end_date: end,
              }),
            ]);
            setData({ load: load.data, cuts: cuts.data });
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load trends.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          From
          <input
            type="date"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button className="secondary" disabled={mode !== 'cloud' || busy}>
          {busy ? 'Loading…' : 'Load trends'}
        </button>
      </form>
      {mode !== 'cloud' && (
        <p>Usage history requires a cloud account connection.</p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {data && (
        <div className="two-col">
          {[
            ['load', 'Average load'],
            ['cuts', 'Power cuts'],
          ].map(([key, label]) => (
            <div key={key}>
              <h3>{label}</h3>
              {Object.keys(object(data[key as 'load' | 'cuts'])).length ? (
                <dl>
                  {Object.entries(object(data[key as 'load' | 'cuts'])).map(
                    ([date, value]) => (
                      <div className="stat-line" key={date}>
                        <dt>{date}</dt>
                        <dd>
                          {typeof value === 'object'
                            ? JSON.stringify(value)
                            : textValue(value)}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              ) : (
                <p>No readings for these dates.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
