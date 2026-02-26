type IncidentStatus =
  | "PENDING_NETWORK"
  | "RECEIVED"
  | "ASSIGNED"
  | "RESOLVED"
  | "CANCELLED"
  | "UNASSIGNED_RETRY";

type Action =
  | { type: "REASSIGN"; incidentId: string }
  | { type: "SET_INCIDENT_STATUS"; incidentId: string; status: IncidentStatus }
  | { type: "SET_RESPONDER_AVAILABILITY"; deviceId: string; available: boolean };

interface Incident {
  id: string;
  createdAtMs: number;
  lat: number;
  lng: number;
  accuracyM: number;
  status: IncidentStatus;
  priority: number;
  sourceDeviceId: string;
  assignedDriverId: string | null;
  assignedAtMs: number | null;
  resolvedAtMs: number | null;
}

interface Responder {
  deviceId: string;
  name: string;
  status: "AVAILABLE" | "BUSY" | "OFFLINE" | "UNAVAILABLE";
  lastLat: number;
  lastLng: number;
  lastFixAtMs: number;
  batteryPct: number;
  activeAssignments: number;
  lastAssignedAtMs: number;
}

interface DispatchSnapshot {
  incidents: Incident[];
  responders: Responder[];
  peers: unknown[];
  mapStyleUrl: string | null;
  lastUpdatedMs: number;
}

interface DispatchRequest {
  command?: "ACTION" | "SIMULATE_SOS" | "RESET_DEMO";
  action?: Action;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * 6_371_000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createInitialState(): DispatchSnapshot {
  const now = Date.now();
  return {
    incidents: [],
    responders: [
      {
        deviceId: "driver-alpha",
        name: "Driver Alpha",
        status: "AVAILABLE",
        lastLat: 40.73061,
        lastLng: -73.935242,
        lastFixAtMs: now,
        batteryPct: 88,
        activeAssignments: 0,
        lastAssignedAtMs: 0
      },
      {
        deviceId: "driver-bravo",
        name: "Driver Bravo",
        status: "AVAILABLE",
        lastLat: 40.7413,
        lastLng: -73.9897,
        lastFixAtMs: now,
        batteryPct: 70,
        activeAssignments: 0,
        lastAssignedAtMs: 0
      }
    ],
    peers: [],
    mapStyleUrl: "https://demotiles.maplibre.org/style.json",
    lastUpdatedMs: now
  };
}

function randomIncidentId(): string {
  return `incident-${crypto.randomUUID()}`;
}

function assignNearest(state: DispatchSnapshot, incidentId: string): void {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) {
    return;
  }

  const candidates = state.responders
    .filter((item) => item.status === "AVAILABLE")
    .filter((item) => item.lastFixAtMs >= Date.now() - 120_000)
    .filter((item) => item.batteryPct >= 15)
    .map((responder) => ({
      responder,
      distance: haversineMeters(incident.lat, incident.lng, responder.lastLat, responder.lastLng)
    }))
    .sort((a, b) => a.distance - b.distance);

  const winner = candidates[0]?.responder;
  if (!winner) {
    incident.status = "UNASSIGNED_RETRY";
    incident.assignedDriverId = null;
    return;
  }

  incident.assignedDriverId = winner.deviceId;
  incident.status = "ASSIGNED";
  incident.assignedAtMs = Date.now();
  winner.status = "BUSY";
  winner.activeAssignments += 1;
  winner.lastAssignedAtMs = Date.now();
}

function simulateSos(state: DispatchSnapshot): void {
  const incident: Incident = {
    id: randomIncidentId(),
    createdAtMs: Date.now(),
    lat: 40.7 + (Math.random() * 0.09),
    lng: -74.02 + (Math.random() * 0.1),
    accuracyM: 10 + (Math.random() * 20),
    status: "RECEIVED",
    priority: 1,
    sourceDeviceId: "vercel-web",
    assignedDriverId: null,
    assignedAtMs: null,
    resolvedAtMs: null
  };
  state.incidents.unshift(incident);
  assignNearest(state, incident.id);
}

function applyAction(state: DispatchSnapshot, action: Action): void {
  switch (action.type) {
    case "SET_RESPONDER_AVAILABILITY": {
      const responder = state.responders.find((item) => item.deviceId === action.deviceId);
      if (responder) {
        responder.status = action.available ? "AVAILABLE" : "UNAVAILABLE";
      }
      return;
    }
    case "SET_INCIDENT_STATUS": {
      const incident = state.incidents.find((item) => item.id === action.incidentId);
      if (incident) {
        incident.status = action.status;
        if (action.status === "RESOLVED" || action.status === "CANCELLED") {
          incident.resolvedAtMs = Date.now();
        }
      }
      return;
    }
    case "REASSIGN": {
      const incident = state.incidents.find((item) => item.id === action.incidentId);
      if (incident) {
        incident.status = "UNASSIGNED_RETRY";
        incident.assignedDriverId = null;
        assignNearest(state, incident.id);
      }
      return;
    }
  }
}

function jitterResponders(state: DispatchSnapshot): void {
  const now = Date.now();
  for (const responder of state.responders) {
    responder.lastLat += (Math.random() - 0.5) * 0.0008;
    responder.lastLng += (Math.random() - 0.5) * 0.0008;
    responder.lastFixAtMs = now;
  }
}

function mutableState(): DispatchSnapshot {
  const holder = globalThis as unknown as { __emerganceDispatchState?: DispatchSnapshot };
  if (!holder.__emerganceDispatchState) {
    holder.__emerganceDispatchState = createInitialState();
  }
  return holder.__emerganceDispatchState;
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const state = mutableState();

  if (req.method === "GET") {
    jitterResponders(state);
    state.lastUpdatedMs = Date.now();
    res.status(200).json(state);
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const body = (req.body ?? {}) as DispatchRequest;
  switch (body.command) {
    case "SIMULATE_SOS":
      simulateSos(state);
      break;
    case "RESET_DEMO":
      (globalThis as unknown as { __emerganceDispatchState?: DispatchSnapshot }).__emerganceDispatchState =
        createInitialState();
      break;
    case "ACTION":
      if (body.action) {
        applyAction(state, body.action);
      }
      break;
    default:
      break;
  }

  state.lastUpdatedMs = Date.now();
  res.status(200).json({ ok: true });
}
