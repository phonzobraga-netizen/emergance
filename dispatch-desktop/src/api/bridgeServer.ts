import express, { Request } from "express";
import http from "node:http";
import type { ServerResponse } from "node:http";
import { DispatchService } from "../core/dispatchService";
import { IncidentStatus } from "../core/types";

export interface BridgeServerHandle {
  url: string;
  close: () => Promise<void>;
}

export async function startBridgeServer(
  dispatchService: DispatchService,
  host = "0.0.0.0",
  port = 37024
): Promise<BridgeServerHandle> {
  const app = express();
  const streamClients = new Map<ServerResponse, { protocol: string; hostname: string }>();
  app.use(express.json({ limit: "1mb" }));

  const hostnameFromRequest = (req: Request): string => {
    const protocol = req.protocol || "http";
    const hostHeader = req.get("host") || req.hostname || "";
    if (!hostHeader) {
      return "localhost";
    }
    try {
      return new URL(`${protocol}://${hostHeader}`).hostname;
    } catch {
      return req.hostname || "localhost";
    }
  };

  const snapshotForRequest = (req: Request) => {
    const snapshot = dispatchService.getSnapshot();
    if (!snapshot.mapStyleUrl) {
      return snapshot;
    }

    const requestProtocol = req.protocol || "http";
    const requestHostname = hostnameFromRequest(req);

    try {
      const rewritten = new URL(snapshot.mapStyleUrl);
      rewritten.protocol = `${requestProtocol}:`;
      rewritten.hostname = requestHostname;
      return {
        ...snapshot,
        mapStyleUrl: rewritten.toString()
      };
    } catch {
      return snapshot;
    }
  };

  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  });

  app.options("/api/dispatch", (_req, res) => {
    res.status(204).end();
  });

  app.get("/api/dispatch", (req, res) => {
    res.json(snapshotForRequest(req));
  });

  app.get("/api/dispatch/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const clientContext = {
      protocol: req.protocol || "http",
      hostname: hostnameFromRequest(req)
    };
    streamClients.set(res, clientContext);
    const initial = JSON.stringify(snapshotForRequest(req));
    res.write(`data: ${initial}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15_000);

    res.on("close", () => {
      clearInterval(keepAlive);
      streamClients.delete(res);
    });
  });

  app.post("/api/dispatch", async (req, res) => {
    const body = (req.body ?? {}) as {
      command?: "ACTION";
      action?: {
        type?: "REASSIGN" | "SET_INCIDENT_STATUS" | "SET_RESPONDER_AVAILABILITY" | "PING_ORIGIN";
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
    };

    try {
      if (body.command === "ACTION" && body.action) {
        const action = body.action;
        switch (action.type) {
          case "REASSIGN":
            if (action.incidentId) {
              await dispatchService.manualReassign(action.incidentId);
            }
            break;
          case "SET_INCIDENT_STATUS":
            if (action.incidentId && action.status) {
              await dispatchService.manualStatusUpdate(action.incidentId, action.status, action.reason);
            }
            break;
          case "SET_RESPONDER_AVAILABILITY":
            if (action.deviceId && typeof action.available === "boolean") {
              dispatchService.setResponderAvailability(action.deviceId, action.available);
            }
            break;
          case "PING_ORIGIN":
            if (
              action.sourceId &&
              typeof action.lat === "number" &&
              typeof action.lng === "number"
            ) {
              dispatchService.pingOrigin({
                sourceId: action.sourceId,
                source: action.source,
                lat: action.lat,
                lng: action.lng,
                accuracyM: action.accuracyM,
                pingAtMs: action.pingAtMs
              });
            }
            break;
          default:
            break;
        }
      }

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
      });
    }
  });

  const server = http.createServer(app);
  const pushState = (): void => {
    for (const [client, clientContext] of streamClients.entries()) {
      const snapshot = dispatchService.getSnapshot();
      if (snapshot.mapStyleUrl) {
        try {
          const rewritten = new URL(snapshot.mapStyleUrl);
          rewritten.protocol = `${clientContext.protocol}:`;
          rewritten.hostname = clientContext.hostname;
          snapshot.mapStyleUrl = rewritten.toString();
        } catch {
          // Keep original style URL when rewrite fails.
        }
      }
      client.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    }
  };
  dispatchService.on("state", pushState);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  return {
    url: `http://${host === "0.0.0.0" ? "localhost" : host}:${port}/api/dispatch`,
    close: async () => {
      dispatchService.off("state", pushState);
      for (const client of streamClients.keys()) {
        client.end();
      }
      streamClients.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}
