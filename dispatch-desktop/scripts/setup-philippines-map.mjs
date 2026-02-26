#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";

const MAP_URL = "https://download.geofabrik.de/asia/philippines-shortbread-1.0.mbtiles";
const MAP_FILE = "philippines-shortbread-1.0.mbtiles";
const MAP_MD5_URL = `${MAP_URL}.md5`;
const LICENSE_URL = "https://www.openstreetmap.org/copyright";

function parseArgs(argv) {
  const args = {
    outputDir: defaultOutputDir(),
    force: false,
    skipVerify: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output-dir" && argv[i + 1]) {
      args.outputDir = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg === "--skip-verify") {
      args.skipVerify = true;
      continue;
    }
  }

  return args;
}

function defaultOutputDir() {
  if (process.env.EMERGANCE_MAP_DIR) {
    return path.resolve(process.env.EMERGANCE_MAP_DIR);
  }
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, "Emergance", "maps");
  }
  return path.join(os.homedir(), ".emergance", "maps");
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.text();
}

async function downloadToFile(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

async function fileMd5(filePath) {
  const hash = crypto.createHash("md5");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

function parseMd5(md5Raw) {
  const line = md5Raw.split("\n").find((item) => item.trim().length > 0);
  if (!line) {
    return null;
  }
  const match = line.trim().match(/^([a-fA-F0-9]{32})/);
  return match ? match[1].toLowerCase() : null;
}

function readMbtilesMetadata(mbtilesPath) {
  const db = new DatabaseSync(mbtilesPath, { readOnly: true, allowExtension: false });
  try {
    const rows = db.prepare("SELECT name, value FROM metadata").all();
    const map = new Map();
    for (const row of rows) {
      map.set(String(row.name), String(row.value));
    }
    return map;
  } finally {
    db.close();
  }
}

function ensureCatalogDb(catalogPath) {
  const db = new DatabaseSync(catalogPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS map_assets (
      code TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      source_url TEXT NOT NULL,
      license_url TEXT NOT NULL,
      format TEXT,
      bounds TEXT,
      center TEXT,
      checksum_md5 TEXT,
      size_bytes INTEGER NOT NULL,
      downloaded_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS map_layers (
      layer_name TEXT PRIMARY KEY,
      description TEXT NOT NULL
    );
  `);

  const upsertAsset = db.prepare(`
    INSERT INTO map_assets (
      code, title, file_path, source_url, license_url, format, bounds, center, checksum_md5, size_bytes, downloaded_at_ms
    ) VALUES (
      @code, @title, @filePath, @sourceUrl, @licenseUrl, @format, @bounds, @center, @checksum, @sizeBytes, @downloadedAt
    )
    ON CONFLICT(code) DO UPDATE SET
      title = excluded.title,
      file_path = excluded.file_path,
      source_url = excluded.source_url,
      license_url = excluded.license_url,
      format = excluded.format,
      bounds = excluded.bounds,
      center = excluded.center,
      checksum_md5 = excluded.checksum_md5,
      size_bytes = excluded.size_bytes,
      downloaded_at_ms = excluded.downloaded_at_ms
  `);

  const upsertLayer = db.prepare(`
    INSERT INTO map_layers (layer_name, description)
    VALUES (?, ?)
    ON CONFLICT(layer_name) DO UPDATE SET description = excluded.description
  `);

  return { db, upsertAsset, upsertLayer };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outputDir, { recursive: true });

  const mbtilesPath = path.join(options.outputDir, MAP_FILE);
  const tmpPath = `${mbtilesPath}.download`;

  let expectedMd5Raw = null;
  if (!options.skipVerify) {
    expectedMd5Raw = await fetchText(MAP_MD5_URL).catch(() => null);
    if (!expectedMd5Raw) {
      console.warn(`Checksum file unavailable, continuing without MD5 verify: ${MAP_MD5_URL}`);
    }
  }
  const expectedMd5 = expectedMd5Raw ? parseMd5(expectedMd5Raw) : null;

  let shouldDownload = true;
  if (fs.existsSync(mbtilesPath) && !options.force) {
    shouldDownload = false;
    if (expectedMd5) {
      const currentMd5 = await fileMd5(mbtilesPath);
      if (currentMd5 !== expectedMd5) {
        shouldDownload = true;
      }
    }
  }

  if (shouldDownload) {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
    console.log(`Downloading ${MAP_URL}`);
    await downloadToFile(MAP_URL, tmpPath);

    if (expectedMd5) {
      const downloadedMd5 = await fileMd5(tmpPath);
      if (downloadedMd5 !== expectedMd5) {
        throw new Error(
          `MD5 mismatch for downloaded file (expected ${expectedMd5}, got ${downloadedMd5}).`
        );
      }
    }

    fs.renameSync(tmpPath, mbtilesPath);
    console.log(`Map pack saved: ${mbtilesPath}`);
  } else {
    console.log(`Map pack already up to date: ${mbtilesPath}`);
  }

  const metadata = readMbtilesMetadata(mbtilesPath);
  const bounds = metadata.get("bounds") ?? "";
  const center = metadata.get("center") ?? "";
  const format = metadata.get("format") ?? "pbf";
  const checksum = expectedMd5 ?? (await fileMd5(mbtilesPath));
  const sizeBytes = fs.statSync(mbtilesPath).size;
  const downloadedAt = Date.now();

  const catalogPath = path.join(options.outputDir, "philippines-map-catalog.db");
  const { db, upsertAsset, upsertLayer } = ensureCatalogDb(catalogPath);
  try {
    upsertAsset.run({
      code: "ph_shortbread_v1",
      title: "Philippines Shortbread MBTiles",
      filePath: mbtilesPath,
      sourceUrl: MAP_URL,
      licenseUrl: LICENSE_URL,
      format,
      bounds,
      center,
      checksum,
      sizeBytes,
      downloadedAt
    });

    const layers = [
      ["ocean", "Ocean polygons"],
      ["land", "Land polygons"],
      ["water_polygons", "Lakes, rivers and waterbodies"],
      ["water_lines", "Rivers and canals"],
      ["boundaries", "Administrative boundaries"],
      ["street_polygons", "Road area polygons"],
      ["streets", "Road centerlines"],
      ["buildings", "Building footprints"],
      ["pois", "Points of interest"]
    ];

    for (const [layerName, description] of layers) {
      upsertLayer.run(layerName, description);
    }
  } finally {
    db.close();
  }

  console.log(`Catalog DB updated: ${catalogPath}`);
  console.log("");
  console.log("Use this map pack in dispatch-desktop:");
  console.log(`$env:EMERGANCE_MAP_PACK='${mbtilesPath}'`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
