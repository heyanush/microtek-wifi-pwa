# Microtek+ WiFi PWA

A source-based web port of Microtek+ WiFi Android 2.5.14. Android sources are preserved in `../Microtek+Wifi_2`. The production PWA is hosted at [heyanush.github.io/microtek-wifi-pwa](https://heyanush.github.io/microtek-wifi-pwa/).

## Run

Requires Node 22.13+ (Node 24 recommended).

```sh
npm install
npm run dev
```

Open the printed localhost address. Sign in with your existing Microtek mobile/email and password or OTP. The sample mode is explicitly simulated and never connects to equipment.

```sh
npm run build
npm start
```

Build the static GitHub Pages application with:

```sh
npm run build:pages
```

Pushes to `main` run typechecking, tests, the static build and GitHub Pages deployment through `.github/workflows/pages.yml`.

For installation use an HTTPS deployment or a production localhost server. Choose **Install** when your browser offers it; on iOS use Safari → Share → Add to Home Screen. Development mode intentionally does not register a service worker. Production caches the public app shell and built assets, never account/API responses or commands. Offline snapshots contain only device names, model information and readings; UATs, Wi-Fi passwords, and account tokens are excluded. **Exit/Sign out** removes saved readings. If browser storage is unavailable, snapshots are unavailable.

## Local connections

Run on the **same computer as the browser**:

```sh
npm run bridge
```

Keep this terminal open and enter the printed pairing key in **Direct Wi-Fi**. The bridge binds its HTTP API to loopback only. It does not expose device control to your LAN. This configuration cannot be used directly from a phone: the bridge must run on the browser's computer. A mobile deployment needs a separately secured HTTPS LAN gateway or native companion; a pure PWA cannot replace Android's Wi-Fi selection/UDP privileges.

1. Sign in and choose an existing device, then choose **Use local Wi-Fi**. This fills the device's UAT and Wi-Fi password from its authorized cloud configuration.
2. Connect your computer manually to the inverter Wi-Fi in operating-system settings. Enter the actual gateway IP (the form suggests `192.168.4.1`; this is a common starting value, not an address established by the APK).
3. Select **Inverter Wi-Fi (HTTP)**. The bridge reads `/gds?uat=…` and writes JSON to `/sds`, matching `ThingLocalHttpInterface`.
4. Alternatively, connect the computer and inverter to the same home network, enter the inverter LAN IP and select **Home network (encrypted LAN)**. This listens for Android-compatible broadcasts on UDP 15951 and sends the original AES-CBC state-command format.
5. The local UAT, bridge key and device password remain in page memory only. For an offline reload, enter them again. A bridge running on the inverter Wi-Fi can continue to operate without cloud internet.

Browser private-network policies may require permission or block hosted-to-loopback access. Use the PWA's local server on the same computer in that case. Do not disable browser security. UDP 15951 must be available for LAN mode; direct HTTP mode works independently.

Bridge environment: `BRIDGE_PORT` (default `8788`), `BRIDGE_KEY` (otherwise randomly generated each start), `PWA_ORIGINS` (comma-separated exact permitted origins). The UI currently connects to port 8788. Defaults permit `http://localhost:3000` and `https://heyanush.github.io`. No `.env` file is needed. Do not put bridge keys or device credentials in source control. Avoid putting pairing keys in shell history; use the generated value.

## Ported features

- Password/OTP login; signup and password-reset request forms using the APK request schema.
- Home and device selection, manual cloud status refresh, automatic MQTT reconnect, device presence reports.
- Mains/output voltage, frequency, load, backup estimate, battery voltage/current/status/type, solar measurements, fault alerts.
- Front switch, UPS, buzzer, vacation, turbo charging, high power and forced mains cut. Settings only appear enabled when reported by the device and a control connection is present. Reported read-only ownership disables cloud controls.
- Settings remain at the reported value until a matching inverter report arrives. Commands time out visibly and are never stored or replayed offline.
- Device rename, date-range average-load and power-cut history, original LUXE/i-Lithium manuals.
- Direct Wi-Fi HTTP and encrypted LAN control through the included local bridge.
- Install manifest, original app icon, offline shell, explicitly labelled saved readings and sample mode.

## Remaining Android-only / unported features

- Automatic Wi-Fi scanning/joining, EspTouch/SmartConfig and new-device onboarding. Pair new devices with the Android app first.
- OTA firmware updates, warranty registration, CRM complaints, product registration, account deletion, sharing/invitations and home/room administration.
- Background push notifications, notification preferences, weather/exchange-rate integrations, energy calculator, advanced performance/battery configuration and localization.

The extracted APK contains third-party API keys. None are copied into this PWA. CRM endpoints and those credentials are not used. Extending these integrations requires authorized service configuration and separate validation.

## Architecture and protocol provenance

- `lib/protocol.ts`: fields and commands mapped from `common/models/FeatureMetric.java`, `FeatureId.java`, `InverterState.java`, `Thing.java`.
- `lib/direct-cloud.ts`: GitHub Pages REST adapter for the original Microtek API. The API base comes from `BuildConfig.java`; authentication schemas come from `PreauthInterface` / `PreAuthRepo`. Compatibility headers retain Android's API and application versions.
- On GitHub Pages, the bearer token is kept in browser `localStorage` until its reported expiry (capped at 24 hours) so an installed PWA remains signed in after relaunch. Signing out or token expiry removes it. Treat any script running on this origin as able to access that token.
- `lib/direct-cloud.ts` also obtains authorized configuration from `GET config` and creates the 15-minute AWS IoT WSS signature with Web Crypto. Temporary AWS credentials therefore exist in page memory while connecting. `MqttClientManager.java` is the source for subscription topics and desired-state publications.
- `app/api/session`, `app/api/cloud`, and `app/api/mqtt` remain available for local/server builds but are not used by the static GitHub Pages deployment.
- `bridge/protocol.mjs`: `ThingLocalHttpInterface.java`, `UDPCommunicationManager.java`, `DataUtils.java`. LAN commands preserve the APK's unusual IV-prefixed-plaintext encryption convention; tests cover the corresponding decoding. This is protocol compatibility, not a redesign of legacy device cryptography.
- `public/sw.js` / `scripts/precache.mjs`: production-only public shell and asset caching. Service-worker upgrades wait until old tabs close to avoid mixing releases.

Reference documentation: [AWS IoT protocols](https://docs.aws.amazon.com/iot/latest/developerguide/protocols.html), [PWA reference](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Reference).

## Validation

```sh
npm test
npm run typecheck
npm run build
npm run build:pages
# Authored code only (the supplied component catalog has pre-existing lint failures):
./node_modules/.bin/oxlint app lib bridge scripts tests
```

Protocol tests cover state parsing, unsupported commands, fault codes, private-IP restrictions, LAN encryption, HTTP endpoint/payload compatibility, and AWS signing structure. They use simulated devices and test credentials. No automated test sends a real account login, OTP, or inverter command.

Before relying on this with equipment, verify login, home/device retrieval, fresh telemetry, broker access and one reversible setting against your inverter. Verify both direct and LAN transports, then test loss/recovery of internet and Wi-Fi. Upstream response shapes, access permissions and individual inverter firmware may differ from the decompiled version.
