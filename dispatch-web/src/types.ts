export type IncidentStatus =
  | "PENDING_NETWORK"
  | "RECEIVED"
  | "ASSIGNED"
  | "RESOLVED"
  | "CANCELLED"
  | "UNASSIGNED_RETRY";

export interface Incident {
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

export interface Responder {
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

export interface PeerSnapshot {
  deviceId: string;
  role: "SOS" | "DRIVER" | "DISPATCH" | "RELAY";
  host: string;
  port: number;
  transport: "LAN" | "WIFI_DIRECT" | "BLE";
  lastSeenMs: number;
}

export type OriginSource = "WEB" | "DESKTOP" | "APP" | "DRIVER" | "UNKNOWN";

export interface OriginPing {
  sourceId: string;
  source: OriginSource;
  lat: number;
  lng: number;
  accuracyM: number;
  withinPhilippines: boolean;
  lastPingAtMs: number;
}

export interface DispatchSnapshot {
  incidents: Incident[];
  responders: Responder[];
  peers: PeerSnapshot[];
  origins: OriginPing[];
  mapStyleUrl: string | null;
  lastUpdatedMs: number;
}

export type DispatchAction =
  | { type: "REASSIGN"; incidentId: string }
  | { type: "SET_INCIDENT_STATUS"; incidentId: string; status: IncidentStatus; reason?: string }
  | { type: "SET_RESPONDER_AVAILABILITY"; deviceId: string; available: boolean }
  | {
      type: "PING_ORIGIN";
      source: OriginSource;
      sourceId: string;
      lat: number;
      lng: number;
      accuracyM?: number;
      pingAtMs?: number;
    };
