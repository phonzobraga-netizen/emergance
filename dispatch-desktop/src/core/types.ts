export const SCHEMA_VERSION = 1;

export type MessageType =
  | "SOS_CREATE"
  | "SOS_RECEIVED_ACK"
  | "DRIVER_HEARTBEAT"
  | "ASSIGNMENT_OFFER"
  | "ASSIGNMENT_ACK"
  | "ASSIGNMENT_REJECT"
  | "INCIDENT_STATUS_UPDATE"
  | "PEER_HELLO"
  | "STORE_FORWARD_BUNDLE";

export type DeviceRole = "SOS" | "DRIVER" | "DISPATCH" | "RELAY";

export type IncidentStatus =
  | "PENDING_NETWORK"
  | "RECEIVED"
  | "ASSIGNED"
  | "RESOLVED"
  | "CANCELLED"
  | "UNASSIGNED_RETRY";

export type LocationQuality = "LIVE" | "DEGRADED";

export type TransportKind = "LAN" | "WIFI_DIRECT" | "BLE";

export interface Coordinate {
  lat: number;
  lng: number;
  accuracyM: number;
  fixAtMs: number;
  quality: LocationQuality;
}

export interface SosCreatePayload {
  incidentId: string;
  coordinate: Coordinate;
  clientCreatedAtMs: number;
  notes?: string;
}

export interface SosReceivedAckPayload {
  messageId: string;
  incidentId: string;
  receivedAtMs: number;
}

export interface DriverHeartbeatPayload {
  deviceId: string;
  onDuty: boolean;
  available: boolean;
  coordinate: Coordinate;
  batteryPct: number;
}

export interface AssignmentOfferPayload {
  assignmentId: string;
  incidentId: string;
  driverDeviceId: string;
  incidentCoordinate: Coordinate;
  ackDeadlineMs: number;
}

export interface AssignmentAckPayload {
  assignmentId: string;
  incidentId: string;
  driverDeviceId: string;
  ackAtMs: number;
}

export interface AssignmentRejectPayload {
  assignmentId: string;
  incidentId: string;
  driverDeviceId: string;
  reason: string;
  rejectedAtMs: number;
}

export interface IncidentStatusUpdatePayload {
  incidentId: string;
  status: IncidentStatus;
  assignedDriverId?: string;
  updatedAtMs: number;
  reason?: string;
}

export interface PeerHelloPayload {
  deviceId: string;
  role: DeviceRole;
  transports: TransportKind[];
  sentAtMs: number;
}

export interface StoreForwardBundlePayload {
  envelopes: Envelope[];
}

export type Payload =
  | { type: "SOS_CREATE"; value: SosCreatePayload }
  | { type: "SOS_RECEIVED_ACK"; value: SosReceivedAckPayload }
  | { type: "DRIVER_HEARTBEAT"; value: DriverHeartbeatPayload }
  | { type: "ASSIGNMENT_OFFER"; value: AssignmentOfferPayload }
  | { type: "ASSIGNMENT_ACK"; value: AssignmentAckPayload }
  | { type: "ASSIGNMENT_REJECT"; value: AssignmentRejectPayload }
  | { type: "INCIDENT_STATUS_UPDATE"; value: IncidentStatusUpdatePayload }
  | { type: "PEER_HELLO"; value: PeerHelloPayload }
  | { type: "STORE_FORWARD_BUNDLE"; value: StoreForwardBundlePayload };

export interface Envelope {
  schemaVersion: number;
  messageId: string;
  incidentId: string;
  type: MessageType;
  senderDeviceId: string;
  senderRole: DeviceRole;
  createdAtMs: number;
  ttlMs: number;
  hopCount: number;
  ackRequired: boolean;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  signature: Uint8Array;
  keyId: Uint8Array;
  requiredAckFor: Uint8Array;
}

export interface OutboxRecord {
  messageId: string;
  targetDeviceId: string | null;
  envelopeBlob: Buffer;
  attempts: number;
  nextAttemptAtMs: number;
  expiresAtMs: number;
}

export interface PeerSnapshot {
  deviceId: string;
  role: DeviceRole;
  host: string;
  port: number;
  transport: TransportKind;
  lastSeenMs: number;
}

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

export interface DriverState {
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

export interface DriverCandidate {
  driver: DriverState;
  distanceMeters: number;
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
  responders: DriverState[];
  peers: PeerSnapshot[];
  origins: OriginPing[];
  mapStyleUrl: string | null;
  lastUpdatedMs: number;
}
