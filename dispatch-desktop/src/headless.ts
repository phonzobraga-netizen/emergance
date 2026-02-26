import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DispatchDatabase } from "./db/database";
import { AssignmentEngine } from "./core/assignmentEngine";
import { TransportManager } from "./network/transportManager";
import { KeyStore } from "./security/keyStore";
import { CryptoService } from "./security/crypto";
import { DispatchService } from "./core/dispatchService";
import { startTileServer } from "./map/tileServer";
import { startBridgeServer } from "./api/bridgeServer";

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
      candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      return candidates[0];
    }
  }

  return path.join(uniqueMapDirs[0], "philippines-shortbread-1.0.mbtiles");
}

function resolveUserDataPath(): string {
  if (process.env.EMERGANCE_USER_DATA) {
    return path.resolve(process.env.EMERGANCE_USER_DATA);
  }

  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, "emergance-dispatch-desktop");
  }

  return path.join(os.homedir(), ".emergance-dispatch-desktop");
}

async function main(): Promise<void> {
  const userData = resolveUserDataPath();
  fs.mkdirSync(userData, { recursive: true });

  const missionFilePath = path.join(userData, "keys", "mission-keys.json");
  const mapPackPath = resolveMapPackPath(userData);
  const dbPath = path.join(userData, "db", "dispatch.db");

  const keyStore = await KeyStore.loadOrInit(missionFilePath, "dispatch-main");
  const crypto = new CryptoService({ identity: keyStore.identity, networkKey: keyStore.networkKey });
  const db = new DispatchDatabase(dbPath);
  const transport = new TransportManager(keyStore.identity.deviceId, "DISPATCH");
  const assignmentEngine = new AssignmentEngine();
  const tileServer = await startTileServer(mapPackPath, 0);
  const dispatchService = new DispatchService(db, transport, crypto, keyStore, assignmentEngine, {
    mapStyleUrl: tileServer.styleUrl
  });

  await dispatchService.start();
  const bridge = await startBridgeServer(dispatchService);

  // eslint-disable-next-line no-console
  console.log("Emergance dispatch headless runtime started");
  // eslint-disable-next-line no-console
  console.log(`Bridge API: ${bridge.url}`);
  // eslint-disable-next-line no-console
  console.log(`Tile style: ${tileServer.styleUrl}`);
  // eslint-disable-next-line no-console
  console.log(`Map pack: ${mapPackPath}`);
  // eslint-disable-next-line no-console
  console.log(`Mission file: ${missionFilePath}`);

  const shutdown = async () => {
    dispatchService.stop();
    db.close();
    await bridge.close();
    await tileServer.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
