# Dispatch Desktop

## Commands

```powershell
npm install
npm run build
npm test
npm start
npm run map:philippines
npm run start:headless
```

## Environment

- Optional `EMERGANCE_MAP_PACK` path to MBTiles file.
- Optional `EMERGANCE_USER_DATA` path for headless runtime DB/key storage.
- Local web bridge API: `http://localhost:37024/api/dispatch`

## Philippines Offline Map Setup

The `map:philippines` script downloads the full Philippines Shortbread MBTiles package from Geofabrik,
verifies checksum, and creates a local catalog database.

```powershell
npm run map:philippines
```

Optional flags:

```powershell
node scripts/setup-philippines-map.mjs --output-dir C:\maps\emergance --force
```

Outputs:

- `philippines-shortbread-1.0.mbtiles` (map tiles database)
- `philippines-map-catalog.db` (asset/layer catalog metadata)

## Headless Sync Runtime

If you only need the sync backend (no desktop window), run:

```powershell
npm run start:headless
```

This starts:

- LAN transport (`37020` discovery UDP + `37021` TCP framed transport)
- Bridge API (`http://localhost:37024/api/dispatch`)
- Local tile/style server bound to loopback

## Key Files

- `src/main.ts`: Electron bootstrap + IPC + service startup.
- `src/core/dispatchService.ts`: ingest, dedupe, assignment engine integration, retry loop.
- `src/network/transportManager.ts`: LAN transport + fallback adapter chain.
- `src/map/tileServer.ts`: local MBTiles loopback tile server.
- `src/db/database.ts`: SQLite WAL schema and persistence operations.
