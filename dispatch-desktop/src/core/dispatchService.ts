import { EventEmitter } from "node:events";
import { decodeEnvelope, decodePayload, encodePayload, newEnvelope } from "./protocol";
import { AssignmentEngine } from "./assignmentEngine";
import { nextRetryDelayMs } from "./retryPolicy";
import {
  AssignmentAckPayload,
  AssignmentOfferPayload,
  AssignmentRejectPayload,
  DispatchSnapshot,
  DriverHeartbeatPayload,
  Envelope,
  IncidentStatus,
  IncidentStatusUpdatePayload,
  OriginPing,
  OriginSource,
  Payload,
  SosCreatePayload,
  SosReceivedAckPayload
} from "./types";
import { DispatchDatabase } from "../db/database";
import { TransportManager } from "../network/transportManager";
import { CryptoService } from "../security/crypto";
import { KeyStore } from "../security/keyStore";
import { ReliabilityStore } from "./reliabilityStore";

export interface DispatchServiceOptions {
  mapStyleUrl: string | null;
}

const PHILIPPINES_BOUNDS: [number, number, number, number] = [112.1661, 4.382696, 127.0742, 21.53021];
const MAX_ORIGIN_PINGS = 64;
const ORIGIN_TTL_MS = 24 * 60 * 60 * 1_000;

function isFiniteCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function isWithinPhilippines(lat: number, lng: number): boolean {
  const [west, south, east, north] = PHILIPPINES_BOUNDS;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

function normalizeOriginSource(source: string | undefined): OriginSource {
  switch ((source || "").toUpperCase()) {
    case "WEB":
      return "WEB";
    case "DESKTOP":
      return "DESKTOP";
    case "APP":
      return "APP";
    case "DRIVER":
      return "DRIVER";
    default:
      return "UNKNOWN";
  }
}

export class DispatchService extends EventEmitter {
  private readonly reliability: ReliabilityStore;
  private readonly originPings = new Map<string, OriginPing>();
  private retryTimer: NodeJS.Timeout | null = null;
  private assignmentTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DispatchDatabase,
    private readonly transport: TransportManager,
    private readonly crypto: CryptoService,
    private readonly keyStore: KeyStore,
    private readonly assignmentEngine: AssignmentEngine,
    private readonly options: DispatchServiceOptions
  ) {
    super();
    this.reliability = new ReliabilityStore(db);
  }

  async start(): Promise<void> {
    await this.crypto.init();

    this.transport.on("envelope", async (envelope, via, host) => {
      try {
        await this.handleIncomingEnvelope(envelope, via, host);
      } catch (error) {
        this.emit("error", error);
      }
    });

    await this.transport.start();

    this.retryTimer = setInterval(() => {
      void this.flushOutbox();
    }, 500);

    this.assignmentTimer = setInterval(() => {
      void this.reconcileAssignments();
    }, 1_000);

    this.emitState();
  }

  stop(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.assignmentTimer) {
      clearInterval(this.assignmentTimer);
      this.assignmentTimer = null;
    }
  }

  getSnapshot(): DispatchSnapshot {
    return {
      incidents: this.db.listIncidents(),
      responders: this.db.listResponders(),
      peers: this.transport.peers(),
      origins: Array.from(this.originPings.values()).sort((a, b) => b.lastPingAtMs - a.lastPingAtMs),
      mapStyleUrl: this.options.mapStyleUrl,
      lastUpdatedMs: Date.now()
    };
  }

  setResponderAvailability(deviceId: string, available: boolean): void {
    this.db.setResponderAvailability(deviceId, available);
    this.emitState();
  }

  pingOrigin(params: {
    sourceId: string;
    source?: string;
    lat: number;
    lng: number;
    accuracyM?: number;
    pingAtMs?: number;
  }): void {
    const sourceId = params.sourceId.trim();
    if (!sourceId || !isFiniteCoordinate(params.lat, params.lng)) {
      return;
    }

    const key = `${normalizeOriginSource(params.source)}:${sourceId}`;
    const pingAtMs = Number.isFinite(params.pingAtMs) ? Number(params.pingAtMs) : Date.now();
    const accuracyM = Number.isFinite(params.accuracyM) ? Math.max(Number(params.accuracyM), 0) : 0;
    const source = normalizeOriginSource(params.source);

    this.originPings.set(key, {
      sourceId,
      source,
      lat: params.lat,
      lng: params.lng,
      accuracyM,
      withinPhilippines: isWithinPhilippines(params.lat, params.lng),
      lastPingAtMs: pingAtMs
    });
    this.pruneOriginPings();
    this.emitState();
  }

  async manualStatusUpdate(incidentId: string, status: IncidentStatus, reason?: string): Promise<void> {
    this.db.updateIncidentStatus({ incidentId, status, reason });
    if (status === "UNASSIGNED_RETRY") {
      await this.tryAssignIncident(incidentId);
    }
    this.emitState();
  }

  async manualReassign(incidentId: string): Promise<void> {
    this.db.updateIncidentStatus({ incidentId, status: "UNASSIGNED_RETRY", reason: "MANUAL_REASSIGN" });
    await this.tryAssignIncident(incidentId);
    this.emitState();
  }

  private async handleIncomingEnvelope(
    envelope: Envelope,
    _via: string,
    _host: string
  ): Promise<void> {
    const now = Date.now();

    if (envelope.createdAtMs + envelope.ttlMs <= now) {
      return;
    }

    let trustedPublicKey = this.keyStore.getPublicKey(envelope.senderDeviceId);
    let verified = false;
    if (trustedPublicKey !== null) {
      verified = await this.crypto.verifyEnvelope(envelope as never, trustedPublicKey);
    }
    if (!verified && envelope.keyId.length > 0) {
      const announcedPublicKey = Uint8Array.from(envelope.keyId);
      const autoTrusted = await this.crypto.verifyEnvelope(envelope as never, announcedPublicKey);
      if (autoTrusted) {
        this.keyStore.rememberTrustedDevice(envelope.senderDeviceId, envelope.senderRole, announcedPublicKey);
        trustedPublicKey = announcedPublicKey;
        verified = true;
      }
    }

    const duplicate = this.db.hasProcessedMessage(envelope.messageId);
    this.db.logMessage({
      messageId: envelope.messageId,
      type: envelope.type,
      senderDeviceId: envelope.senderDeviceId,
      receivedAtMs: now,
      verified,
      duplicate,
      rawSize: envelope.ciphertext.length + envelope.signature.length + envelope.nonce.length
    });

    if (duplicate || !verified) {
      return;
    }

    this.db.markProcessedMessage(envelope.messageId, now);

    const clearPayload = await this.crypto.decrypt(envelope.ciphertext, envelope.nonce).catch(() => null);
    if (!clearPayload) {
      return;
    }

    const payload = decodePayload(clearPayload);

    if (envelope.requiredAckFor.length > 0) {
      const ackedMessageId = Buffer.from(envelope.requiredAckFor).toString("utf8");
      if (ackedMessageId) {
        this.reliability.markAcked(ackedMessageId, now);
      }
    }

    await this.routePayload(payload, envelope.senderDeviceId, envelope.messageId);
    this.emitState();
  }

  private async routePayload(payload: Payload, senderDeviceId: string, incomingMessageId: string): Promise<void> {
    switch (payload.type) {
      case "SOS_CREATE": {
        const body = payload.value as SosCreatePayload;
        this.db.upsertIncidentFromSos({
          incidentId: body.incidentId,
          lat: body.coordinate.lat,
          lng: body.coordinate.lng,
          accuracyM: body.coordinate.accuracyM,
          createdAtMs: body.clientCreatedAtMs,
          sourceDeviceId: senderDeviceId,
          status: "RECEIVED"
        });

        const ack: SosReceivedAckPayload = {
          messageId: incomingMessageId,
          incidentId: body.incidentId,
          receivedAtMs: Date.now()
        };

        await this.sendSecureMessage({
          type: "SOS_RECEIVED_ACK",
          payload: ack,
          incidentId: body.incidentId,
          targetDeviceId: senderDeviceId,
          ttlMs: 60_000,
          ackRequired: false
        });

        await this.tryAssignIncident(body.incidentId);
        break;
      }

      case "SOS_RECEIVED_ACK": {
        const body = payload.value as SosReceivedAckPayload;
        this.reliability.markAcked(body.messageId, body.receivedAtMs || Date.now());
        break;
      }

      case "DRIVER_HEARTBEAT": {
        this.db.upsertResponderFromHeartbeat(payload.value as DriverHeartbeatPayload);
        break;
      }

      case "ASSIGNMENT_ACK": {
        const body = payload.value as AssignmentAckPayload;
        this.db.markAssignmentAck(body.assignmentId, body.ackAtMs || Date.now());
        break;
      }

      case "ASSIGNMENT_REJECT": {
        const body = payload.value as AssignmentRejectPayload;
        this.db.markAssignmentRejected(body.assignmentId, body.reason || "REJECTED");
        await this.tryAssignIncident(body.incidentId);
        break;
      }

      case "INCIDENT_STATUS_UPDATE": {
        const body = payload.value as IncidentStatusUpdatePayload;
        this.db.updateIncidentStatus({
          incidentId: body.incidentId,
          status: body.status,
          assignedDriverId: body.assignedDriverId ?? null,
          reason: body.reason
        });
        break;
      }

      case "STORE_FORWARD_BUNDLE": {
        const bundle = payload.value.envelopes;
        for (const forwardedEnvelope of bundle) {
          await this.handleIncomingEnvelope(forwardedEnvelope, "LAN", "relay");
        }
        break;
      }

      case "ASSIGNMENT_OFFER":
      case "PEER_HELLO":
        break;

      default:
        break;
    }
  }

  private async tryAssignIncident(incidentId: string): Promise<void> {
    const incident = this.db.getIncident(incidentId);
    if (!incident || incident.status === "ASSIGNED") {
      return;
    }

    const now = Date.now();
    const candidates = this.db.getAvailableResponders(now);
    const choice = this.assignmentEngine.chooseDriver(incident, candidates);

    if (!choice) {
      this.db.updateIncidentStatus({ incidentId, status: "UNASSIGNED_RETRY", reason: "NO_AVAILABLE_DRIVER" });
      return;
    }

    const ackDeadlineMs = now + 15_000;
    const assignmentId = this.db.createAssignment(incidentId, choice.driver.deviceId, ackDeadlineMs);

    const offerPayload: AssignmentOfferPayload = {
      assignmentId,
      incidentId,
      driverDeviceId: choice.driver.deviceId,
      incidentCoordinate: {
        lat: incident.lat,
        lng: incident.lng,
        accuracyM: incident.accuracyM,
        fixAtMs: incident.createdAtMs,
        quality: "LIVE"
      },
      ackDeadlineMs
    };

    await this.sendSecureMessage({
      type: "ASSIGNMENT_OFFER",
      payload: offerPayload,
      incidentId,
      targetDeviceId: choice.driver.deviceId,
      ttlMs: 60_000,
      ackRequired: true
    });
  }

  private async sendSecureMessage(params: {
    type: Payload["type"];
    payload: unknown;
    incidentId?: string;
    targetDeviceId?: string;
    ttlMs: number;
    ackRequired: boolean;
    requiredAckFor?: string;
  }): Promise<string> {
    const plaintext = encodePayload({ type: params.type, value: params.payload as never } as Payload);
    const encrypted = await this.crypto.encrypt(plaintext);

    const envelope = newEnvelope({
      type: params.type,
      payloadCiphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      senderDeviceId: this.keyStore.identity.deviceId,
      senderRole: "DISPATCH",
      incidentId: params.incidentId,
      ackRequired: params.ackRequired,
      keyId: this.keyStore.identity.publicKey,
      ttlMs: params.ttlMs,
      requiredAckFor: params.requiredAckFor
        ? Uint8Array.from(Buffer.from(params.requiredAckFor, "utf8"))
        : undefined
    });

    envelope.signature = await this.crypto.signEnvelope(envelope);

    this.reliability.enqueue(envelope, params.targetDeviceId ?? null, Date.now() + params.ttlMs);
    return envelope.messageId;
  }

  private async flushOutbox(): Promise<void> {
    const now = Date.now();
    this.db.expireOutbox(now);

    const due = this.db.dueOutbox(now, 100);
    for (const entry of due) {
      const envelope = decodeEnvelope(entry.envelopeBlob);
      const sent = await this.transport.send(envelope, entry.targetDeviceId ?? undefined);
      const delayMs = nextRetryDelayMs(entry.attempts);
      this.db.recordOutboxAttempt(entry.messageId, now + delayMs);

      if (!sent) {
        continue;
      }
    }
  }

  private async reconcileAssignments(): Promise<void> {
    const now = Date.now();
    const timedOut = this.db.expireTimedOutAssignments(now);
    for (const item of timedOut) {
      await this.tryAssignIncident(item.incidentId);
    }

    const retryIncidents = this.db.listRetryIncidents(now);
    for (const incident of retryIncidents) {
      await this.tryAssignIncident(incident.id);
    }

    if (timedOut.length > 0 || retryIncidents.length > 0) {
      this.emitState();
    }
  }

  private emitState(): void {
    for (const peer of this.transport.peers()) {
      this.db.upsertPeer(peer);
    }
    this.emit("state", this.getSnapshot());
  }

  private pruneOriginPings(): void {
    const now = Date.now();
    for (const [key, ping] of this.originPings.entries()) {
      if (ping.lastPingAtMs + ORIGIN_TTL_MS < now) {
        this.originPings.delete(key);
      }
    }

    if (this.originPings.size <= MAX_ORIGIN_PINGS) {
      return;
    }

    const sorted = Array.from(this.originPings.entries()).sort((a, b) => b[1].lastPingAtMs - a[1].lastPingAtMs);
    for (const [key] of sorted.slice(MAX_ORIGIN_PINGS)) {
      this.originPings.delete(key);
    }
  }
}
