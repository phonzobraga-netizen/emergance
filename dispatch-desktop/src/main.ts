import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain, session } from "electron";
import { DispatchDatabase } from "./db/database";
import { AssignmentEngine } from "./core/assignmentEngine";
import { TransportManager } from "./network/transportManager";
import { KeyStore } from "./security/keyStore";
import { CryptoService } from "./security/crypto";
import { DispatchService } from "./core/dispatchService";
import { startTileServer } from "./map/tileServer";
import { IncidentStatus } from "./core/types";
import { startBridgeServer } from "./api/bridgeServer";

let mainWindow: BrowserWindow | null = null;
let dispatchService: DispatchService | null = null;
let db: DispatchDatabase | null = null;
let tileServerCloser: (() => Promise<void>) | null = null;
let bridgeCloser: (() => Promise<void>) | null = null;
let missionFilePath = "";

function rendererPath(): string {
  return path.resolve(__dirname, "..", "src", "renderer", "index.html");
}

function resolveMapPackPath(userData: string): string {
  if (process.env.EMERGANCE_MAP_PACK) {
    return process.env.EMERGANCE_MAP_PACK;
  }

  const mapDirs = [path.join(userData, "maps")];
  if (process.env.APPDATA) {
    mapDirs.push(path.join(process.env.APPDATA, "Emergance", "maps"));
  }

  const uniqueMapDirs = Array.from(new Set(mapDirs));

  for (const mapDir of uniqueMapDirs) {
    const versionedDefault = path.join(mapDir, "philippines-shortbread-1.0.mbtiles");
    if (fs.existsSync(versionedDefault)) {
      return versionedDefault;
    }

    const legacyDefault = path.join(mapDir, "philippines.mbtiles");
    if (fs.existsSync(legacyDefault)) {
      return legacyDefault;
    }

    if (!fs.existsSync(mapDir) || !fs.statSync(mapDir).isDirectory()) {
      continue;
    }

    const candidates = fs
      .readdirSync(mapDir)
      .filter((name) => /^philippines.*\.mbtiles$/i.test(name))
      .map((name) => path.join(mapDir, name))
      .filter((candidate) => fs.existsSync(candidate));
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const aTime = fs.statSync(a).mtimeMs;
        const bTime = fs.statSync(b).mtimeMs;
        return bTime - aTime;
      });
      return candidates[0];
    }
  }

  return path.join(uniqueMapDirs[0], "philippines-shortbread-1.0.mbtiles");
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath("userData");
  missionFilePath = path.join(userData, "keys", "mission-keys.json");
  const mapPackPath = resolveMapPackPath(userData);
  const dbPath = path.join(userData, "db", "dispatch.db");

  const keyStore = await KeyStore.loadOrInit(missionFilePath, "dispatch-main");
  const crypto = new CryptoService({ identity: keyStore.identity, networkKey: keyStore.networkKey });

  db = new DispatchDatabase(dbPath);
  const transport = new TransportManager(keyStore.identity.deviceId, "DISPATCH");
  const assignmentEngine = new AssignmentEngine();

  const tileServer = await startTileServer(mapPackPath, 0);
  tileServerCloser = tileServer.close;

  dispatchService = new DispatchService(db, transport, crypto, keyStore, assignmentEngine, {
    mapStyleUrl: tileServer.styleUrl
  });

  dispatchService.on("state", (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("emergance:state", state);
    }
  });

  dispatchService.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("Dispatch service error", error);
  });

  await dispatchService.start();
  const bridge = await startBridgeServer(dispatchService);
  bridgeCloser = bridge.close;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.resolve(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  await mainWindow.loadFile(rendererPath());
}

function registerIpc(): void {
  ipcMain.handle("emergance:get-snapshot", async () => {
    return dispatchService?.getSnapshot() ?? null;
  });

  ipcMain.handle("emergance:mission-file", async () => missionFilePath);

  ipcMain.handle("emergance:action", async (_event, action: unknown) => {
    if (!dispatchService || !action || typeof action !== "object") {
      return { ok: false, error: "INVALID_ACTION" };
    }

    const command = action as {
      type?: string;
      incidentId?: string;
      status?: IncidentStatus;
      reason?: string;
      deviceId?: string;
      available?: boolean;
      sourceId?: string;
      source?: string;
      lat?: number;
      lng?: number;
      accuracyM?: number;
      pingAtMs?: number;
    };

    switch (command.type) {
      case "REASSIGN":
        if (!command.incidentId) {
          return { ok: false, error: "MISSING_INCIDENT" };
        }
        await dispatchService.manualReassign(command.incidentId);
        return { ok: true };
      case "SET_INCIDENT_STATUS":
        if (!command.incidentId || !command.status) {
          return { ok: false, error: "MISSING_FIELDS" };
        }
        await dispatchService.manualStatusUpdate(command.incidentId, command.status, command.reason);
        return { ok: true };
      case "SET_RESPONDER_AVAILABILITY":
        if (!command.deviceId || typeof command.available !== "boolean") {
          return { ok: false, error: "MISSING_FIELDS" };
        }
        dispatchService.setResponderAvailability(command.deviceId, command.available);
        return { ok: true };
      case "PING_ORIGIN":
        if (
          !command.sourceId ||
          typeof command.lat !== "number" ||
          typeof command.lng !== "number"
        ) {
          return { ok: false, error: "MISSING_FIELDS" };
        }
        dispatchService.pingOrigin({
          sourceId: command.sourceId,
          source: command.source,
          lat: command.lat,
          lng: command.lng,
          accuracyM: command.accuracyM,
          pingAtMs: command.pingAtMs
        });
        return { ok: true };
      default:
        return { ok: false, error: "UNKNOWN_ACTION" };
    }
  });
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "geolocation");
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "geolocation";
  });

  registerIpc();
  await bootstrap();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  dispatchService?.stop();
  db?.close();
  if (bridgeCloser) {
    await bridgeCloser();
  }
  if (tileServerCloser) {
    await tileServerCloser();
  }
});
