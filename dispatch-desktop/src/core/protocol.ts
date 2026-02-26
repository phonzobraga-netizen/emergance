import path from "node:path";
import protobuf from "protobufjs";
import { v7 as uuidv7 } from "uuid";
import {
  DeviceRole,
  Envelope,
  MessageType,
  Payload,
  SCHEMA_VERSION
} from "./types";

const typeToProtoNumber: Record<MessageType, number> = {
  SOS_CREATE: 1,
  SOS_RECEIVED_ACK: 2,
  DRIVER_HEARTBEAT: 3,
  ASSIGNMENT_OFFER: 4,
  ASSIGNMENT_ACK: 5,
  ASSIGNMENT_REJECT: 6,
  INCIDENT_STATUS_UPDATE: 7,
  PEER_HELLO: 8,
  STORE_FORWARD_BUNDLE: 9
};

const roleToProtoNumber: Record<DeviceRole, number> = {
  SOS: 1,
  DRIVER: 2,
  DISPATCH: 3,
  RELAY: 4
};

const protoToRole: Record<number, DeviceRole> = {
  1: "SOS",
  2: "DRIVER",
  3: "DISPATCH",
  4: "RELAY"
};

const protoToType: Record<number, MessageType> = {
  1: "SOS_CREATE",
  2: "SOS_RECEIVED_ACK",
  3: "DRIVER_HEARTBEAT",
  4: "ASSIGNMENT_OFFER",
  5: "ASSIGNMENT_ACK",
  6: "ASSIGNMENT_REJECT",
  7: "INCIDENT_STATUS_UPDATE",
  8: "PEER_HELLO",
  9: "STORE_FORWARD_BUNDLE"
};

function resolveProtoPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "..", "shared", "proto", "envelope.proto"),
    path.resolve(process.cwd(), "shared", "proto", "envelope.proto"),
    path.resolve(__dirname, "..", "..", "..", "shared", "proto", "envelope.proto"),
    path.resolve(__dirname, "..", "..", "shared", "proto", "envelope.proto")
  ];

  for (const candidate of candidates) {
    try {
      protobuf.loadSync(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new Error("Unable to locate shared proto file (envelope.proto)");
}

const root = protobuf.loadSync(resolveProtoPath());
const EnvelopeType = root.lookupType("emergance.Envelope");
const PayloadType = root.lookupType("emergance.Payload");

function normalizeBytes(value: Uint8Array | Buffer | number[] | string | null | undefined): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === "string") {
    return Uint8Array.from(Buffer.from(value, "base64"));
  }
  return Uint8Array.from(value as number[]);
}

function payloadToProto(payload: Payload): Record<string, unknown> {
  switch (payload.type) {
    case "SOS_CREATE":
      return { sosCreate: payload.value };
    case "SOS_RECEIVED_ACK":
      return { sosReceivedAck: payload.value };
    case "DRIVER_HEARTBEAT":
      return { driverHeartbeat: payload.value };
    case "ASSIGNMENT_OFFER":
      return { assignmentOffer: payload.value };
    case "ASSIGNMENT_ACK":
      return { assignmentAck: payload.value };
    case "ASSIGNMENT_REJECT":
      return { assignmentReject: payload.value };
    case "INCIDENT_STATUS_UPDATE":
      return { incidentStatusUpdate: payload.value };
    case "PEER_HELLO":
      return { peerHello: payload.value };
    case "STORE_FORWARD_BUNDLE":
      return {
        storeForwardBundle: {
          envelopes: payload.value.envelopes.map((envelope) => toProtoEnvelope(envelope))
        }
      };
    default:
      throw new Error(`Unsupported payload type ${(payload as { type: string }).type}`);
  }
}

function payloadFromProto(decoded: Record<string, unknown>): Payload {
  if (decoded.sosCreate) {
    return { type: "SOS_CREATE", value: decoded.sosCreate as Payload["value"] } as Payload;
  }
  if (decoded.sosReceivedAck) {
    return { type: "SOS_RECEIVED_ACK", value: decoded.sosReceivedAck as Payload["value"] } as Payload;
  }
  if (decoded.driverHeartbeat) {
    return { type: "DRIVER_HEARTBEAT", value: decoded.driverHeartbeat as Payload["value"] } as Payload;
  }
  if (decoded.assignmentOffer) {
    return { type: "ASSIGNMENT_OFFER", value: decoded.assignmentOffer as Payload["value"] } as Payload;
  }
  if (decoded.assignmentAck) {
    return { type: "ASSIGNMENT_ACK", value: decoded.assignmentAck as Payload["value"] } as Payload;
  }
  if (decoded.assignmentReject) {
    return { type: "ASSIGNMENT_REJECT", value: decoded.assignmentReject as Payload["value"] } as Payload;
  }
  if (decoded.incidentStatusUpdate) {
    return {
      type: "INCIDENT_STATUS_UPDATE",
      value: decoded.incidentStatusUpdate as Payload["value"]
    } as Payload;
  }
  if (decoded.peerHello) {
    return { type: "PEER_HELLO", value: decoded.peerHello as Payload["value"] } as Payload;
  }
  if (decoded.storeForwardBundle) {
    const envelopes = (decoded.storeForwardBundle as { envelopes?: unknown[] }).envelopes ?? [];
    return {
      type: "STORE_FORWARD_BUNDLE",
      value: {
        envelopes: envelopes.map((item) => fromProtoEnvelope(item as Record<string, unknown>))
      }
    };
  }
  throw new Error("Unsupported payload body");
}

function toProtoEnvelope(envelope: Envelope): Record<string, unknown> {
  return {
    schemaVersion: envelope.schemaVersion,
    messageId: envelope.messageId,
    incidentId: envelope.incidentId,
    type: typeToProtoNumber[envelope.type],
    senderDeviceId: envelope.senderDeviceId,
    senderRole: roleToProtoNumber[envelope.senderRole],
    createdAtMs: envelope.createdAtMs,
    ttlMs: envelope.ttlMs,
    hopCount: envelope.hopCount,
    ackRequired: envelope.ackRequired,
    nonce: Buffer.from(envelope.nonce),
    ciphertext: Buffer.from(envelope.ciphertext),
    signature: Buffer.from(envelope.signature),
    keyId: Buffer.from(envelope.keyId),
    requiredAckFor: Buffer.from(envelope.requiredAckFor)
  };
}

function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number(value);
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value && typeof value === "object" && "low" in (value as Record<string, unknown>)) {
    return Number((value as { toString?: () => string }).toString?.() ?? 0);
  }
  return 0;
}

function fromProtoEnvelope(decoded: Record<string, unknown>): Envelope {
  return {
    schemaVersion: asNumber(decoded.schemaVersion),
    messageId: String(decoded.messageId ?? ""),
    incidentId: String(decoded.incidentId ?? ""),
    type: protoToType[asNumber(decoded.type)] ?? "PEER_HELLO",
    senderDeviceId: String(decoded.senderDeviceId ?? ""),
    senderRole: protoToRole[asNumber(decoded.senderRole)] ?? "RELAY",
    createdAtMs: asNumber(decoded.createdAtMs),
    ttlMs: asNumber(decoded.ttlMs),
    hopCount: asNumber(decoded.hopCount),
    ackRequired: Boolean(decoded.ackRequired),
    nonce: normalizeBytes(decoded.nonce as Uint8Array),
    ciphertext: normalizeBytes(decoded.ciphertext as Uint8Array),
    signature: normalizeBytes(decoded.signature as Uint8Array),
    keyId: normalizeBytes(decoded.keyId as Uint8Array),
    requiredAckFor: normalizeBytes(decoded.requiredAckFor as Uint8Array)
  };
}

export function encodePayload(payload: Payload): Uint8Array {
  const candidate = payloadToProto(payload);
  const err = PayloadType.verify(candidate);
  if (err) {
    throw new Error(`Payload verify failed: ${err}`);
  }
  return PayloadType.encode(PayloadType.create(candidate)).finish();
}

export function decodePayload(bytes: Uint8Array): Payload {
  const decoded = PayloadType.toObject(PayloadType.decode(bytes), {
    longs: Number,
    defaults: true,
    bytes: Buffer
  }) as Record<string, unknown>;
  return payloadFromProto(decoded);
}

export function encodeEnvelope(envelope: Envelope): Buffer {
  const protoEnvelope = toProtoEnvelope(envelope);
  const err = EnvelopeType.verify(protoEnvelope);
  if (err) {
    throw new Error(`Envelope verify failed: ${err}`);
  }
  return Buffer.from(EnvelopeType.encode(EnvelopeType.create(protoEnvelope)).finish());
}

export function decodeEnvelope(bytes: Uint8Array): Envelope {
  const decoded = EnvelopeType.toObject(EnvelopeType.decode(bytes), {
    longs: Number,
    defaults: true,
    bytes: Buffer
  }) as Record<string, unknown>;
  return fromProtoEnvelope(decoded);
}

export function unsignedEnvelopeBytes(envelope: Envelope): Uint8Array {
  const unsigned: Envelope = {
    ...envelope,
    signature: new Uint8Array()
  };
  return encodeEnvelope(unsigned);
}

export interface NewEnvelopeInput {
  type: MessageType;
  payloadCiphertext: Uint8Array;
  nonce: Uint8Array;
  senderDeviceId: string;
  senderRole: DeviceRole;
  incidentId?: string;
  ackRequired?: boolean;
  ttlMs: number;
  keyId?: Uint8Array;
  requiredAckFor?: Uint8Array;
}

export function newEnvelope(input: NewEnvelopeInput): Envelope {
  return {
    schemaVersion: SCHEMA_VERSION,
    messageId: uuidv7(),
    incidentId: input.incidentId ?? "",
    type: input.type,
    senderDeviceId: input.senderDeviceId,
    senderRole: input.senderRole,
    createdAtMs: Date.now(),
    ttlMs: input.ttlMs,
    hopCount: 0,
    ackRequired: input.ackRequired ?? false,
    nonce: input.nonce,
    ciphertext: input.payloadCiphertext,
    signature: new Uint8Array(),
    keyId: input.keyId ?? new Uint8Array(),
    requiredAckFor: input.requiredAckFor ?? new Uint8Array()
  };
}