# Emergance Dispatch Web

Web clone of the desktop dispatch interface, prepared for Vercel deployment.

## What It Does

- Incident list, responder roster, map markers, and assignment link lines.
- Manual controls: reassign, resolve/cancel incident, toggle responder availability.
- Two data modes:
  - `Local Demo`: browser-only simulation stored in localStorage.
  - `Remote API`: polls a dispatch endpoint.
- Includes a Vercel serverless demo endpoint at `api/dispatch`.

## Local Run

```powershell
cd emergance/dispatch-web
npm install
npm run dev
```

## Build

```powershell
npm run build
```

## Deploy To Vercel

1. Import `emergance/dispatch-web` as the project root in Vercel.
2. Framework preset: `Vite` (auto-detected).
3. Build command: `npm run build`
4. Output directory: `dist`
5. Deploy.

After deploy:
- Open the site.
- Leave mode on `Remote API` and keep API base as `/api/dispatch` to use the built-in serverless demo backend.

## Connect To Desktop Dispatch (Live LAN Data)

If `dispatch-desktop` is running locally, it now serves:

- `http://localhost:37024/api/dispatch`
- `http://localhost:37024/api/dispatch/events` (live stream)

Set the web app to:

- Mode: `Remote API`
- API Base: `http://localhost:37024/api/dispatch`

Then the web dashboard mirrors the desktop dispatcher state/actions.

When opened on `localhost`, the web app now forces remote sync mode and auto-targets
`http://localhost:37024/api/dispatch` by default.

## Note

This web build is a cloud-debug mirror, not a full offline LAN dispatch replacement. For production offline operations, keep using `dispatch-desktop`.
