# Android App

## Module

- `app`: SOS + Driver dual-role Android application.

## Highlights

- Large red SOS long-press (1.2s gesture) in SOS mode.
- GPS live fix with degraded fallback up to 120 seconds.
- Local confirmation alert sound/tone.
- Room-backed incident/inbox/outbox reliability queue.
- LAN discovery + framed TCP message transport.
- Driver heartbeat every 5 seconds while on duty.
- Assignment accept/reject flow with ACK/REJECT protocol messages.

## Build

Open `android-app` in Android Studio and build APK from the `app` module.

## Notes

- `WifiDirectTransportAdapter` and `BleTransportAdapter` are scaffolded placeholders.
- Security uses Ed25519 signatures and ChaCha20-Poly1305 envelope encryption in this implementation.