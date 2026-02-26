# Emergance v1

Offline emergency dispatch implementation with:

- `android-app/`: Android SOS + Driver dual-role app (Kotlin/Compose/Room/protobuf).
- `dispatch-desktop/`: Windows desktop dispatch app (Electron + Node + SQLite + MapLibre).
- `dispatch-web/`: Vercel-ready web dashboard mirror (Vite + MapLibre + optional serverless demo API).
- `shared/proto/envelope.proto`: Shared schema used by both apps.

## What Is Implemented

- Shared protobuf envelope + payload schema and message types.
- Signed/encrypted message envelope pipeline.
- Persistent local storage:
  - Android: Room + WAL with incidents/inbox/outbox/peers/driver state.
  - Desktop: SQLite + WAL with incidents/responders/assignments/logs/outbox.
- LAN transport with UDP multicast discovery (`239.10.10.10:37020`) and framed TCP data (`:37021`).
- Outbox retry policy (`0.5s,1s,2s,4s,8s,16s,30s...`) and TTL handling.
- Dispatch nearest-driver auto assignment (Haversine + tie-breaks + ACK timeout/reassign).
- Desktop UI incident list, responder list, manual reassign/resolve/cancel, offline map layer from local MBTiles.
- Android SOS long-press flow, GPS fix/degraded fallback, audible confirmation, incident enqueue/send.
- Android Driver mode heartbeat every 5s, assignment accept/reject sending ACK/REJECT.

## Current Fallback Status

- Wi-Fi Direct and BLE adapter interfaces are implemented and wired.
- Their transport internals are currently stubbed placeholders in v1 codebase (LAN is fully implemented).

## Build / Run

### Dispatch Desktop

```powershell
cd emergance/dispatch-desktop
npm install
npm run test
npm run map:philippines
npm start
# or, no desktop window:
npm run start:headless
```

### Android App

Open `emergance/android-app` in Android Studio and build the `app` module.

Flavor outputs:

- `sosDebug`: SOS-only APK
- `driverDebug`: Driver-only APK
- `unifiedDebug`: dual-mode APK

The environment used for this implementation did not have `gradle` installed globally, so CLI APK build was not executed here.

## Provisioning

Desktop creates mission keypack automatically on first run at app user data path:

- `%APPDATA%/.../keys/mission-keys.json`

Use provisioning script to trust Android device keys:

```powershell
cd emergance/dispatch-desktop
npm run provision -- --mission <mission-file-path> --device <device-id> --role DRIVER --public <base64-public-key>
```

Android creates local keypack at first run in app internal storage (`files/keys/mission-keypack.json`).

## Safety Notes

- All runtime comms are local only; no cloud/API dependencies.
- Map style is served from local loopback tile server.
- Messages from untrusted devices are rejected.
- Replay/duplicate messages are deduplicated via persisted inbox IDs.
