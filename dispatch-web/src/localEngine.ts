import { haversineMeters } from "./haversine";
import { DispatchAction, DispatchSnapshot, Incident, Responder } from "./types";

const STORAGE_KEY = "emergance.dispatch.web.state.v1";
const PH_BOUNDS: [number, number, number, number] = [112.1661, 4.382696, 127.0742, 21.53021];
const PH_CENTER_LAT_LNG: [number, number] = [12.8797, 121.774];

function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function initialResponders(now: number): Responder[] {
  return [
    {
      deviceId: "driver-alpha",
      name: "Driver Alpha",
      status: "AVAILABLE",
      lastLat: 14.5995,
      lastLng: 120.9842,
      lastFixAtMs: now,
      batteryPct: 88,
      activeAssignments: 0,
      lastAssignedAtMs: 0
    },
    {
      deviceId: "driver-bravo",
      name: "Driver Bravo",
      status: "AVAILABLE",
      lastLat: 10.3157,
      lastLng: 123.8854,
      lastFixAtMs: now,
      batteryPct: 70,
      activeAssignments: 0,
      lastAssignedAtMs: 0
    },
    {
      deviceId: "driver-charlie",
      name: "Driver Charlie",
      status: "UNAVAILABLE",
      lastLat: 7.1907,
      lastLng: 125.4553,
      lastFixAtMs: now,
      batteryPct: 51,
      activeAssignments: 0,
      lastAssignedAtMs: 0
    }
  ];
}

function createInitialState(): DispatchSnapshot {
  const now = Date.now();
  return {
    incidents: [],
    responders: initialResponders(now),
    peers: [],
    origins: [],
    mapStyleUrl: null,
    lastUpdatedMs: now
  };
}

function clampToPhilippines(lat: number, lng: number): { lat: number; lng: number } {
  return {
    lat: Math.min(Math.max(lat, PH_BOUNDS[1]), PH_BOUNDS[3]),
    lng: Math.min(Math.max(lng, PH_BOUNDS[0]), PH_BOUNDS[2])
  };
}

function persist(snapshot: DispatchSnapshot): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function loadLocalSnapshot(): DispatchSnapshot {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const state = createInitialState();
    persist(state);
    return state;
  }

  try {
    const parsed = JSON.parse(raw) as DispatchSnapshot;
    if (!Array.isArray(parsed.incidents) || !Array.isArray(parsed.responders)) {
      throw new Error("invalid");
    }
    if (!Array.isArray(parsed.origins)) {
      parsed.origins = [];
    }
    return parsed;
  } catch {
    const state = createInitialState();
    persist(state);
    return state;
  }
}

function assignNearestResponder(incident: Incident, responders: Responder[]): string | null {
  const now = Date.now();
  const candidates = responders
    .filter((responder) => responder.status === "AVAILABLE")
    .filter((responder) => responder.batteryPct >= 15)
    .filter((responder) => responder.lastFixAtMs >= now - 120_000)
    .map((responder) => ({
      responder,
      distance: haversineMeters(incident.lat, incident.lng, responder.lastLat, responder.lastLng)
    }))
    .sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      if (a.responder.activeAssignments !== b.responder.activeAssignments) {
        return a.responder.activeAssignments - b.responder.activeAssignments;
      }
      return a.responder.lastAssignedAtMs - b.responder.lastAssignedAtMs;
    });

  return candidates[0]?.responder.deviceId ?? null;
}

function upsertAssignment(snapshot: DispatchSnapshot, incidentId: string): void {
  const incident = snapshot.incidents.find((item) => item.id === incidentId);
  if (!incident || incident.status === "RESOLVED" || incident.status === "CANCELLED") {
    return;
  }

  const chosen = assignNearestResponder(incident, snapshot.responders);
  if (!chosen) {
    incident.status = "UNASSIGNED_RETRY";
    incident.assignedDriverId = null;
    return;
  }

  incident.assignedDriverId = chosen;
  incident.status = "ASSIGNED";
  incident.assignedAtMs = Date.now();

  const responder = snapshot.responders.find((item) => item.deviceId === chosen);
  if (responder) {
    responder.status = "BUSY";
    responder.activeAssignments += 1;
    responder.lastAssignedAtMs = Date.now();
  }
}

export function applyLocalAction(action: DispatchAction): DispatchSnapshot {
  const snapshot = clone(loadLocalSnapshot());
  const now = Date.now();

  switch (action.type) {
    case "REASSIGN": {
      const incident = snapshot.incidents.find((item) => item.id === action.incidentId);
      if (incident) {
        if (incident.assignedDriverId) {
          const prev = snapshot.responders.find((item) => item.deviceId === incident.assignedDriverId);
          if (prev && prev.activeAssignments > 0) {
            prev.activeAssignments -= 1;
            if (prev.activeAssignments === 0) {
              prev.status = "AVAILABLE";
            }
          }
        }
        incident.status = "UNASSIGNED_RETRY";
        incident.assignedDriverId = null;
        upsertAssignment(snapshot, incident.id);
      }
      break;
    }

    case "SET_INCIDENT_STATUS": {
      const incident = snapshot.incidents.find((item) => item.id === action.incidentId);
      if (incident) {
        incident.status = action.status;
        if (action.status === "RESOLVED" || action.status === "CANCELLED") {
          incident.resolvedAtMs = now;
        }
      }
      break;
    }

    case "SET_RESPONDER_AVAILABILITY": {
      const responder = snapshot.responders.find((item) => item.deviceId === action.deviceId);
      if (responder) {
        responder.status = action.available ? "AVAILABLE" : "UNAVAILABLE";
      }
      break;
    }

    case "PING_ORIGIN": {
      const withinPhilippines =
        action.lng >= PH_BOUNDS[0] &&
        action.lng <= PH_BOUNDS[2] &&
        action.lat >= PH_BOUNDS[1] &&
        action.lat <= PH_BOUNDS[3];
      const index = snapshot.origins.findIndex(
        (origin) => origin.source === action.source && origin.sourceId === action.sourceId
      );
      const next = {
        source: action.source,
        sourceId: action.sourceId,
        lat: action.lat,
        lng: action.lng,
        accuracyM: Number.isFinite(action.accuracyM) ? Number(action.accuracyM) : 0,
        withinPhilippines,
        lastPingAtMs: Number.isFinite(action.pingAtMs) ? Number(action.pingAtMs) : now
      };

      if (index >= 0) {
        snapshot.origins[index] = next;
      } else {
        snapshot.origins.unshift(next);
      }

      snapshot.origins = snapshot.origins
        .sort((a, b) => b.lastPingAtMs - a.lastPingAtMs)
        .slice(0, 64);
      break;
    }
  }

  snapshot.lastUpdatedMs = now;
  persist(snapshot);
  return snapshot;
}

export function addRandomIncident(): DispatchSnapshot {
  const snapshot = clone(loadLocalSnapshot());
  const now = Date.now();
  const available = snapshot.responders.filter((responder) => responder.status !== "UNAVAILABLE");
  const anchor = available[Math.floor(Math.random() * available.length)] ?? snapshot.responders[0];
  const incidentLat = anchor ? anchor.lastLat + ((Math.random() - 0.5) * 0.08) : PH_CENTER_LAT_LNG[0];
  const incidentLng = anchor ? anchor.lastLng + ((Math.random() - 0.5) * 0.08) : PH_CENTER_LAT_LNG[1];
  const incidentPoint = clampToPhilippines(incidentLat, incidentLng);

  const incident: Incident = {
    id: randomId("incident"),
    createdAtMs: now,
    lat: incidentPoint.lat,
    lng: incidentPoint.lng,
    accuracyM: 8 + (Math.random() * 22),
    status: "RECEIVED",
    priority: 1,
    sourceDeviceId: "web-sos-sim",
    assignedDriverId: null,
    assignedAtMs: null,
    resolvedAtMs: null
  };

  snapshot.incidents.unshift(incident);
  upsertAssignment(snapshot, incident.id);
  snapshot.lastUpdatedMs = now;
  persist(snapshot);
  return snapshot;
}

export function tickResponders(): DispatchSnapshot {
  const snapshot = clone(loadLocalSnapshot());
  const now = Date.now();

  snapshot.responders = snapshot.responders.map((responder) => {
    const drift = responder.status === "UNAVAILABLE" ? 0.0002 : 0.0008;
    const lngDelta = (Math.random() - 0.5) * drift;
    const latDelta = (Math.random() - 0.5) * drift;
    const nextPoint = clampToPhilippines(responder.lastLat + latDelta, responder.lastLng + lngDelta);
    return {
      ...responder,
      lastLat: nextPoint.lat,
      lastLng: nextPoint.lng,
      lastFixAtMs: now
    };
  });

  snapshot.lastUpdatedMs = now;
  persist(snapshot);
  return snapshot;
}

export function resetLocalState(): DispatchSnapshot {
  const initial = createInitialState();
  persist(initial);
  return initial;
}
