import fs from "node:fs";
import http from "node:http";
import express, { Request, Response } from "express";
import { DatabaseSync } from "node:sqlite";

const PHILIPPINES_BOUNDS: [number, number, number, number] = [112.1661, 4.382696, 127.0742, 21.53021];
const PHILIPPINES_CENTER: [number, number] = [121.774, 12.8797];
const PHILIPPINES_DEFAULT_ZOOM = 5.4;
const DEFAULT_GLYPHS_URL = "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf";

const OFFLINE_PHILIPPINES_LANDMASS = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: "luzon" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [120.0, 18.0],
            [122.4, 16.8],
            [123.0, 15.0],
            [121.8, 13.0],
            [119.5, 14.3],
            [120.0, 18.0]
          ]
        ]
      }
    },
    {
      type: "Feature",
      properties: { id: "mindoro" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [121.4, 13.6],
            [121.1, 12.2],
            [120.7, 12.2],
            [120.5, 13.1],
            [121.0, 13.8],
            [121.4, 13.6]
          ]
        ]
      }
    },
    {
      type: "Feature",
      properties: { id: "visayas-core" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [122.2, 12.2],
            [124.4, 11.4],
            [123.9, 10.2],
            [122.1, 10.1],
            [121.6, 11.2],
            [122.2, 12.2]
          ]
        ]
      }
    },
    {
      type: "Feature",
      properties: { id: "samar-leyte" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [124.2, 12.5],
            [125.3, 12.0],
            [125.5, 10.8],
            [124.9, 10.1],
            [123.9, 10.2],
            [123.9, 11.4],
            [124.2, 12.5]
          ]
        ]
      }
    },
    {
      type: "Feature",
      properties: { id: "mindanao" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [124.0, 9.8],
            [126.6, 8.5],
            [126.5, 6.2],
            [123.8, 5.3],
            [122.5, 7.1],
            [123.0, 8.9],
            [124.0, 9.8]
          ]
        ]
      }
    },
    {
      type: "Feature",
      properties: { id: "palawan" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [118.2, 11.8],
            [119.1, 10.4],
            [119.0, 8.7],
            [117.6, 9.3],
            [118.2, 11.8]
          ]
        ]
      }
    },
    {
      type: "Feature",
      properties: { id: "sulu" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [120.4, 6.5],
            [121.3, 6.3],
            [122.1, 6.6],
            [122.0, 5.9],
            [121.0, 5.5],
            [120.2, 5.8],
            [120.4, 6.5]
          ]
        ]
      }
    }
  ]
};

const OFFLINE_REFERENCE_CITIES = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "Manila" }, geometry: { type: "Point", coordinates: [120.9842, 14.5995] } },
    { type: "Feature", properties: { name: "Baguio" }, geometry: { type: "Point", coordinates: [120.596, 16.4023] } },
    { type: "Feature", properties: { name: "Tuguegarao" }, geometry: { type: "Point", coordinates: [121.7332, 17.6131] } },
    { type: "Feature", properties: { name: "Legazpi" }, geometry: { type: "Point", coordinates: [123.7438, 13.1391] } },
    { type: "Feature", properties: { name: "Puerto Princesa" }, geometry: { type: "Point", coordinates: [118.7384, 9.7392] } },
    { type: "Feature", properties: { name: "Iloilo" }, geometry: { type: "Point", coordinates: [122.5621, 10.7202] } },
    { type: "Feature", properties: { name: "Cebu" }, geometry: { type: "Point", coordinates: [123.8854, 10.3157] } },
    { type: "Feature", properties: { name: "Tacloban" }, geometry: { type: "Point", coordinates: [125.0, 11.2442] } },
    { type: "Feature", properties: { name: "Dumaguete" }, geometry: { type: "Point", coordinates: [123.3054, 9.3077] } },
    { type: "Feature", properties: { name: "Cagayan de Oro" }, geometry: { type: "Point", coordinates: [124.6319, 8.4542] } },
    { type: "Feature", properties: { name: "Davao" }, geometry: { type: "Point", coordinates: [125.4553, 7.1907] } },
    { type: "Feature", properties: { name: "General Santos" }, geometry: { type: "Point", coordinates: [125.1716, 6.1164] } },
    { type: "Feature", properties: { name: "Zamboanga" }, geometry: { type: "Point", coordinates: [122.079, 6.9214] } }
  ]
};

export interface TileServerResult {
  port: number;
  styleUrl: string;
  close: () => Promise<void>;
}

function isGzipBuffer(input: Buffer): boolean {
  return input.length >= 2 && input[0] === 0x1f && input[1] === 0x8b;
}

function extensionToMime(format: string): string {
  switch (format) {
    case "pbf":
    case "mvt":
      return "application/x-protobuf";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

export function parseBounds(value: string | undefined): [number, number, number, number] | null {
  if (!value) {
    return null;
  }
  const parts = value.split(",").map((item) => Number(item.trim()));
  if (parts.length !== 4 || parts.some((item) => Number.isNaN(item))) {
    return null;
  }
  return [parts[0], parts[1], parts[2], parts[3]];
}

export function parseCenter(value: string | undefined): [number, number] | null {
  if (!value) {
    return null;
  }
  const parts = value.split(",").map((item) => Number(item.trim()));
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
    return null;
  }
  return [parts[0], parts[1]];
}

export function buildOnlineFallbackStyle(
  center: [number, number] = PHILIPPINES_CENTER,
  zoom = PHILIPPINES_DEFAULT_ZOOM,
  bounds: [number, number, number, number] = PHILIPPINES_BOUNDS
) {
  const framePolygon = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id: "ph-bounds" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [bounds[0], bounds[1]],
              [bounds[2], bounds[1]],
              [bounds[2], bounds[3]],
              [bounds[0], bounds[3]],
              [bounds[0], bounds[1]]
            ]
          ]
        }
      }
    ]
  };

  return {
    version: 8,
    name: "Emergance Philippines Offline Fallback",
    center,
    zoom,
    sources: {
      landmass: {
        type: "geojson",
        data: OFFLINE_PHILIPPINES_LANDMASS
      },
      referenceCities: {
        type: "geojson",
        data: OFFLINE_REFERENCE_CITIES
      },
      scopeFrame: {
        type: "geojson",
        data: framePolygon
      }
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": "#dcefff"
        }
      },
      {
        id: "landmass-fill",
        type: "fill",
        source: "landmass",
        paint: {
          "fill-color": "#dce8d0",
          "fill-opacity": 0.92
        }
      },
      {
        id: "landmass-outline",
        type: "line",
        source: "landmass",
        paint: {
          "line-color": "#6e7f66",
          "line-width": 1.2
        }
      },
      {
        id: "scope-frame",
        type: "line",
        source: "scopeFrame",
        paint: {
          "line-color": "#2f4c77",
          "line-width": 1.4,
          "line-dasharray": [2, 1]
        }
      },
      {
        id: "reference-cities",
        type: "circle",
        source: "referenceCities",
        paint: {
          "circle-color": "#1e63b7",
          "circle-radius": 3.8,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.2
        }
      }
    ]
  };
}

export function buildShortbreadVectorStyle(params: {
  host: string;
  bounds: [number, number, number, number];
  center: [number, number];
  zoom: number;
  glyphsUrl?: string | null;
}) {
  const { host, bounds, center, zoom, glyphsUrl } = params;
  const nameField = ["coalesce", ["get", "name_en"], ["get", "name"], ["get", "name_de"]];
  const normalizedGlyphs = typeof glyphsUrl === "string" ? glyphsUrl.trim() : "";
  const style: Record<string, unknown> = {
    version: 8,
    name: "Emergance Philippines Vector",
    center,
    zoom,
    glyphs: normalizedGlyphs || DEFAULT_GLYPHS_URL,
    sources: {
      offline: {
        type: "vector",
        tiles: [`${host}/tiles/{z}/{x}/{y}.pbf`],
        bounds,
        minzoom: 0,
        maxzoom: 14
      }
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": "#e9eff6"
        }
      },
      {
        id: "ocean",
        type: "fill",
        source: "offline",
        "source-layer": "ocean",
        paint: {
          "fill-color": "#9ec4eb"
        }
      },
      {
        id: "land",
        type: "fill",
        source: "offline",
        "source-layer": "land",
        paint: {
          "fill-color": "#dde8d7"
        }
      },
      {
        id: "water-polygons",
        type: "fill",
        source: "offline",
        "source-layer": "water_polygons",
        paint: {
          "fill-color": "#8fbbe8"
        }
      },
      {
        id: "water-lines",
        type: "line",
        source: "offline",
        "source-layer": "water_lines",
        paint: {
          "line-color": "#73a7dc",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6,
            0.5,
            14,
            1.8
          ]
        }
      },
      {
        id: "ferries",
        type: "line",
        source: "offline",
        "source-layer": "ferries",
        paint: {
          "line-color": "#4f88cf",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.6,
            12,
            1.8
          ],
          "line-dasharray": [1.2, 1]
        }
      },
      {
        id: "boundaries",
        type: "line",
        source: "offline",
        "source-layer": "boundaries",
        paint: {
          "line-color": "#8d95a3",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            0.4,
            12,
            1.2
          ],
          "line-dasharray": [2.4, 1.4],
          "line-opacity": 0.75
        }
      },
      {
        id: "street-polygons",
        type: "fill",
        source: "offline",
        "source-layer": "street_polygons",
        paint: {
          "fill-color": "#f4ede2",
          "fill-opacity": 0.85
        }
      },
      {
        id: "streets",
        type: "line",
        source: "offline",
        "source-layer": "streets",
        paint: {
          "line-color": [
            "match",
            ["get", "kind"],
            "motorway",
            "#e98d6d",
            "trunk",
            "#ea9c6f",
            "primary",
            "#f0b676",
            "secondary",
            "#f5c88c",
            "tertiary",
            "#f8d9a0",
            "residential",
            "#ffffff",
            "service",
            "#d3d8e0",
            "rail",
            "#8f70c2",
            "#c2c8d1"
          ],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.4,
            10,
            1.4,
            14,
            3.4
          ]
        }
      },
      {
        id: "bridges",
        type: "line",
        source: "offline",
        "source-layer": "bridges",
        paint: {
          "line-color": "#91623d",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            0.5,
            14,
            2
          ]
        }
      },
      {
        id: "public-transport",
        type: "line",
        source: "offline",
        "source-layer": "public_transport",
        paint: {
          "line-color": "#9d4cc7",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.4,
            14,
            1.2
          ]
        }
      },
      {
        id: "aerialways",
        type: "line",
        source: "offline",
        "source-layer": "aerialways",
        paint: {
          "line-color": "#6f7580",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.4,
            14,
            1
          ],
          "line-dasharray": [1, 0.8]
        }
      },
      {
        id: "buildings",
        type: "fill",
        source: "offline",
        "source-layer": "buildings",
        paint: {
          "fill-color": "#d8c6b8",
          "fill-opacity": 0.82
        }
      },
      {
        id: "sites",
        type: "circle",
        source: "offline",
        "source-layer": "sites",
        minzoom: 11,
        paint: {
          "circle-color": "#7e4f2f",
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            0.8,
            14,
            2.2
          ],
          "circle-opacity": 0.7
        }
      },
      {
        id: "addresses",
        type: "circle",
        source: "offline",
        "source-layer": "addresses",
        minzoom: 12,
        paint: {
          "circle-color": "#6b7280",
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            12,
            0.5,
            14,
            1.3
          ],
          "circle-opacity": 0.55
        }
      },
      {
        id: "pois",
        type: "circle",
        source: "offline",
        "source-layer": "pois",
        minzoom: 10,
        paint: {
          "circle-color": "#ce3b3b",
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.8,
            12,
            1.4,
            14,
            2.8
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.8
        }
      },
      {
        id: "water-polygons-labels",
        type: "symbol",
        source: "offline",
        "source-layer": "water_polygons_labels",
        minzoom: 6,
        layout: {
          "text-field": nameField,
          "text-font": ["Open Sans Regular"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6,
            10,
            13,
            14
          ]
        },
        paint: {
          "text-color": "#2f6695",
          "text-halo-color": "#e9f3ff",
          "text-halo-width": 1.1
        }
      },
      {
        id: "water-lines-labels",
        type: "symbol",
        source: "offline",
        "source-layer": "water_lines_labels",
        minzoom: 9,
        layout: {
          "symbol-placement": "line",
          "text-field": nameField,
          "text-font": ["Open Sans Regular"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            9,
            14,
            12
          ]
        },
        paint: {
          "text-color": "#2b6394",
          "text-halo-color": "#e9f3ff",
          "text-halo-width": 1
        }
      },
      {
        id: "street-labels",
        type: "symbol",
        source: "offline",
        "source-layer": "street_labels",
        minzoom: 11,
        layout: {
          "symbol-placement": "line",
          "text-field": ["coalesce", ["get", "name_en"], ["get", "name"], ["get", "ref"]],
          "text-font": ["Open Sans Regular"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            9,
            14,
            12
          ],
          "text-letter-spacing": 0.04
        },
        paint: {
          "text-color": "#4f5560",
          "text-halo-color": "#fbfcfd",
          "text-halo-width": 1.2
        }
      },
      {
        id: "street-label-points",
        type: "symbol",
        source: "offline",
        "source-layer": "street_labels_points",
        minzoom: 12,
        layout: {
          "text-field": ["coalesce", ["get", "name_en"], ["get", "name"], ["get", "ref"]],
          "text-font": ["Open Sans Regular"],
          "text-size": 11
        },
        paint: {
          "text-color": "#4f5560",
          "text-halo-color": "#fbfcfd",
          "text-halo-width": 1.2
        }
      },
      {
        id: "boundary-labels",
        type: "symbol",
        source: "offline",
        "source-layer": "boundary_labels",
        minzoom: 6,
        layout: {
          "symbol-placement": "line",
          "text-field": nameField,
          "text-font": ["Open Sans Regular"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6,
            10,
            12,
            13
          ]
        },
        paint: {
          "text-color": "#6c7280",
          "text-halo-color": "#f6f8fb",
          "text-halo-width": 1
        }
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "offline",
        "source-layer": "place_labels",
        minzoom: 5,
        layout: {
          "text-field": nameField,
          "text-font": ["Open Sans Bold"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            11,
            8,
            12,
            12,
            16,
            14,
            18
          ]
        },
        paint: {
          "text-color": "#25303d",
          "text-halo-color": "#f6f8fb",
          "text-halo-width": 1.2
        }
      },
      {
        id: "site-labels",
        type: "symbol",
        source: "offline",
        "source-layer": "sites",
        minzoom: 12,
        layout: {
          "text-field": nameField,
          "text-font": ["Open Sans Regular"],
          "text-size": 11
        },
        paint: {
          "text-color": "#51391f",
          "text-halo-color": "#fff8ef",
          "text-halo-width": 0.9
        }
      }
    ]
  };

  if (!normalizedGlyphs) {
    delete style.glyphs;
    style.layers = (style.layers as Array<Record<string, unknown>>).filter((layer) => layer.type !== "symbol");
  }

  return style;
}

function clampBoundsToPhilippines(bounds: [number, number, number, number]): [number, number, number, number] {
  const merged: [number, number, number, number] = [
    Math.max(PHILIPPINES_BOUNDS[0], bounds[0]),
    Math.max(PHILIPPINES_BOUNDS[1], bounds[1]),
    Math.min(PHILIPPINES_BOUNDS[2], bounds[2]),
    Math.min(PHILIPPINES_BOUNDS[3], bounds[3])
  ];
  if (merged[0] >= merged[2] || merged[1] >= merged[3]) {
    return PHILIPPINES_BOUNDS;
  }
  return merged;
}

function clampCenterToPhilippines(center: [number, number]): [number, number] {
  const lng = Math.min(Math.max(center[0], PHILIPPINES_BOUNDS[0]), PHILIPPINES_BOUNDS[2]);
  const lat = Math.min(Math.max(center[1], PHILIPPINES_BOUNDS[1]), PHILIPPINES_BOUNDS[3]);
  return [lng, lat];
}

export async function startTileServer(mapPackPath: string, preferredPort = 0): Promise<TileServerResult> {
  const app = express();
  let mbtilesDb: DatabaseSync | null = null;
  let format = "png";
  let vectorTilePayloadGzip = false;
  let mapBounds: [number, number, number, number] = PHILIPPINES_BOUNDS;
  let mapCenter: [number, number] = PHILIPPINES_CENTER;
  let mapZoom = PHILIPPINES_DEFAULT_ZOOM;

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  if (fs.existsSync(mapPackPath) && fs.statSync(mapPackPath).isFile()) {
    mbtilesDb = new DatabaseSync(mapPackPath, { readOnly: true, allowExtension: false });
    const row = mbtilesDb
      .prepare("SELECT value FROM metadata WHERE name = 'format' LIMIT 1")
      .get() as { value?: string } | undefined;
    if (row?.value) {
      format = row.value;
    }
    if (format === "pbf") {
      const sample = mbtilesDb
        .prepare(
          `SELECT tile_data
           FROM tiles
           WHERE zoom_level = (SELECT MIN(zoom_level) FROM tiles)
           LIMIT 1`
        )
        .get() as { tile_data?: Buffer } | undefined;
      if (sample?.tile_data) {
        vectorTilePayloadGzip = isGzipBuffer(Buffer.from(sample.tile_data));
      }
    }

    const boundsRow = mbtilesDb
      .prepare("SELECT value FROM metadata WHERE name = 'bounds' LIMIT 1")
      .get() as { value?: string } | undefined;
    mapBounds = clampBoundsToPhilippines(parseBounds(boundsRow?.value) ?? PHILIPPINES_BOUNDS);

    const centerRow = mbtilesDb
      .prepare("SELECT value FROM metadata WHERE name = 'center' LIMIT 1")
      .get() as { value?: string } | undefined;
    const parsedCenter = parseCenter(centerRow?.value);
    if (parsedCenter) {
      mapCenter = clampCenterToPhilippines(parsedCenter);
      const centerParts = (centerRow?.value ?? "").split(",").map((item) => Number(item.trim()));
      if (centerParts.length >= 3 && !Number.isNaN(centerParts[2])) {
        mapZoom = centerParts[2];
      }
    }
  }

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, mbtilesLoaded: Boolean(mbtilesDb), ts: new Date().toISOString() });
  });

  app.get("/tiles/:z/:x/:y.:ext", (req: Request, res: Response) => {
    if (!mbtilesDb) {
      res.status(404).json({ error: "Map pack unavailable" });
      return;
    }

    try {
      const z = Number(req.params.z);
      const x = Number(req.params.x);
      const yXyz = Number(req.params.y);
      const yTms = (1 << z) - 1 - yXyz;

      const row = mbtilesDb
        .prepare(
          `SELECT tile_data
           FROM tiles
           WHERE zoom_level = ?
             AND tile_column = ?
             AND tile_row = ?
           LIMIT 1`
        )
        .get(z, x, yTms) as { tile_data?: Buffer } | undefined;

      if (!row?.tile_data) {
        res.status(404).end();
        return;
      }

      const mime = extensionToMime(req.params.ext || format);
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "public, max-age=3600, immutable");
      if ((req.params.ext === "pbf" || format === "pbf") && vectorTilePayloadGzip) {
        res.setHeader("Content-Encoding", "gzip");
      }
      res.status(200).send(Buffer.from(row.tile_data));
    } catch {
      res.status(404).end();
    }
  });

  app.get("/style.json", (req: Request, res: Response) => {
    const host = `${req.protocol}://${req.get("host")}`;

    if (!mbtilesDb) {
      res.json(buildOnlineFallbackStyle(mapCenter, mapZoom, mapBounds));
      return;
    }

    const ext = format === "jpg" ? "jpg" : format === "webp" ? "webp" : format === "pbf" ? "pbf" : "png";

    const sourceType = ext === "pbf" ? "vector" : "raster";
    if (sourceType === "vector") {
      res.json(
        buildShortbreadVectorStyle({
          host,
          bounds: mapBounds,
          center: mapCenter,
          zoom: mapZoom,
          glyphsUrl: process.env.EMERGANCE_GLYPHS_URL ?? ""
        })
      );
      return;
    }

    res.json({
      version: 8,
      name: "Emergance Offline Raster",
      center: mapCenter,
      zoom: mapZoom,
      sources: {
        offline: {
          type: "raster",
          tiles: [`${host}/tiles/{z}/{x}/{y}.${ext}`],
          tileSize: 256,
          bounds: mapBounds,
          minzoom: 0,
          maxzoom: 19
        }
      },
      layers: [
        {
          id: "offline",
          type: "raster",
          source: "offline"
        }
      ]
    });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(preferredPort, "0.0.0.0", () => resolve()));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind local tile server");
  }

  return {
    port: address.port,
    styleUrl: `http://127.0.0.1:${address.port}/style.json`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      mbtilesDb?.close();
      mbtilesDb = null;
    }
  };
}
