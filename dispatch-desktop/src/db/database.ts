import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { v7 as uuidv7 } from "uuid";
import { DriverHeartbeatPayload, DriverState, Incident, IncidentStatus, PeerSnapshot } from "../core/types";

export interface MessageLogInput {
  messageId: string;
  type: string;
  senderDeviceId: string;
  receivedAtMs: number;
  verified: boolean;
  duplicate: boolean;
  rawSize: number;
}

export class DispatchDatabase {
  private readonly db: DatabaseSync;

  constructor(dbFile: string) {
    const dir = path.dirname(dbFile);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA synchronous=NORMAL;");
    this.db.exec("PRAGMA busy_timeout=5000;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        created_at_ms INTEGER NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        accuracy_m REAL NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 1,
        source_device_id TEXT NOT NULL,
        assigned_driver_id TEXT,
        assigned_at_ms INTEGER,
        resolved_at_ms INTEGER,
        updated_at_ms INTEGER NOT NULL,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS responders (
        device_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        last_lat REAL NOT NULL,
        last_lng REAL NOT NULL,
        last_fix_at_ms INTEGER NOT NULL,
        battery_pct INTEGER NOT NULL,
        on_duty INTEGER NOT NULL DEFAULT 0,
        available INTEGER NOT NULL DEFAULT 0,
        active_assignments INTEGER NOT NULL DEFAULT 0,
        last_assigned_at_ms INTEGER NOT NULL DEFAULT 0,
        last_seen_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        driver_id TEXT NOT NULL,
        offer_sent_at_ms INTEGER NOT NULL,
        ack_deadline_ms INTEGER NOT NULL,
        acked_at_ms INTEGER,
        result TEXT NOT NULL,
        reason TEXT,
        FOREIGN KEY(incident_id) REFERENCES incidents(id)
      );

      CREATE TABLE IF NOT EXISTS message_log (
        message_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        sender_device_id TEXT NOT NULL,
        received_at_ms INTEGER NOT NULL,
        verified INTEGER NOT NULL,
        duplicate INTEGER NOT NULL,
        raw_size INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id TEXT PRIMARY KEY,
        processed_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS delivery_receipts (
        message_id TEXT NOT NULL,
        target_device_id TEXT,
        first_sent_ms INTEGER NOT NULL,
        last_retry_ms INTEGER,
        acked_at_ms INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(message_id, target_device_id)
      );

      CREATE TABLE IF NOT EXISTS outbox (
        message_id TEXT PRIMARY KEY,
        target_device_id TEXT,
        envelope_blob BLOB NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        acked_at_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS peers (
        device_id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        transport TEXT NOT NULL,
        last_seen_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
      CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(next_attempt_at_ms, acked_at_ms);
      CREATE INDEX IF NOT EXISTS idx_assignments_result ON assignments(result, ack_deadline_ms);
      CREATE INDEX IF NOT EXISTS idx_responders_status ON responders(status, available, on_duty);
    `);
  }

  close(): void {
    this.db.close();
  }

  hasProcessedMessage(messageId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS present FROM processed_messages WHERE message_id = ?")
      .get(messageId) as { present: number } | undefined;
    return Boolean(row?.present);
  }

  markProcessedMessage(messageId: string, tsMs: number): void {
    this.db
      .prepare(
        "INSERT INTO processed_messages(message_id, processed_at_ms) VALUES(?, ?) ON CONFLICT(message_id) DO NOTHING"
      )
      .run(messageId, tsMs);
  }

  logMessage(input: MessageLogInput): void {
    this.db
      .prepare(
        `INSERT INTO message_log(message_id, type, sender_device_id, received_at_ms, verified, duplicate, raw_size)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET
          type = excluded.type,
          sender_device_id = excluded.sender_device_id,
          received_at_ms = excluded.received_at_ms,
          verified = excluded.verified,
          duplicate = excluded.duplicate,
          raw_size = excluded.raw_size`
      )
      .run(
        input.messageId,
        input.type,
        input.senderDeviceId,
        input.receivedAtMs,
        input.verified ? 1 : 0,
        input.duplicate ? 1 : 0,
        input.rawSize
      );
  }

  upsertIncidentFromSos(params: {
    incidentId: string;
    lat: number;
    lng: number;
    accuracyM: number;
    createdAtMs: number;
    sourceDeviceId: string;
    status?: IncidentStatus;
  }): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO incidents(
          id, created_at_ms, lat, lng, accuracy_m, status, priority, source_device_id, updated_at_ms
        ) VALUES(?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          lat = excluded.lat,
          lng = excluded.lng,
          accuracy_m = excluded.accuracy_m,
          status = excluded.status,
          updated_at_ms = excluded.updated_at_ms`
      )
      .run(
        params.incidentId,
        params.createdAtMs,
        params.lat,
        params.lng,
        params.accuracyM,
        params.status ?? "RECEIVED",
        params.sourceDeviceId,
        now
      );
  }

  updateIncidentStatus(params: {
    incidentId: string;
    status: IncidentStatus;
    assignedDriverId?: string | null;
    reason?: string;
  }): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE incidents
         SET status = ?,
             assigned_driver_id = ?,
             assigned_at_ms = CASE WHEN ? = 'ASSIGNED' THEN ? ELSE assigned_at_ms END,
             resolved_at_ms = CASE WHEN ? IN ('RESOLVED', 'CANCELLED') THEN ? ELSE resolved_at_ms END,
             updated_at_ms = ?,
             reason = ?
         WHERE id = ?`
      )
      .run(
        params.status,
        params.assignedDriverId ?? null,
        params.status,
        now,
        params.status,
        now,
        now,
        params.reason ?? null,
        params.incidentId
      );
  }

  getIncident(incidentId: string): Incident | null {
    const row = this.db.prepare("SELECT * FROM incidents WHERE id = ?").get(incidentId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapIncident(row) : null;
  }

  listIncidents(): Incident[] {
    const rows = this.db
      .prepare("SELECT * FROM incidents ORDER BY CASE status WHEN 'ASSIGNED' THEN 0 WHEN 'RECEIVED' THEN 1 ELSE 2 END, created_at_ms DESC")
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.mapIncident(row));
  }

  upsertResponderFromHeartbeat(payload: DriverHeartbeatPayload): void {
    const now = Date.now();
    const status = payload.onDuty ? (payload.available ? "AVAILABLE" : "BUSY") : "UNAVAILABLE";
    this.db
      .prepare(
        `INSERT INTO responders(
          device_id, name, status, last_lat, last_lng, last_fix_at_ms, battery_pct, on_duty, available, last_seen_ms
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
          status = excluded.status,
          last_lat = excluded.last_lat,
          last_lng = excluded.last_lng,
          last_fix_at_ms = excluded.last_fix_at_ms,
          battery_pct = excluded.battery_pct,
          on_duty = excluded.on_duty,
          available = excluded.available,
          last_seen_ms = excluded.last_seen_ms`
      )
      .run(
        payload.deviceId,
        payload.deviceId,
        status,
        payload.coordinate.lat,
        payload.coordinate.lng,
        payload.coordinate.fixAtMs,
        payload.batteryPct,
        payload.onDuty ? 1 : 0,
        payload.available ? 1 : 0,
        now
      );
  }

  setResponderAvailability(deviceId: string, available: boolean): void {
    this.db
      .prepare(
        `UPDATE responders SET available = ?, status = CASE WHEN on_duty = 1 AND ? = 1 THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END WHERE device_id = ?`
      )
      .run(available ? 1 : 0, available ? 1 : 0, deviceId);
  }

  listResponders(): DriverState[] {
    const rows = this.db
      .prepare("SELECT * FROM responders ORDER BY status ASC, last_seen_ms DESC")
      .all() as Record<string, unknown>[];

    return rows.map((row) => ({
      deviceId: String(row.device_id),
      name: String(row.name),
      status: String(row.status) as DriverState["status"],
      lastLat: Number(row.last_lat),
      lastLng: Number(row.last_lng),
      lastFixAtMs: Number(row.last_fix_at_ms),
      batteryPct: Number(row.battery_pct),
      activeAssignments: Number(row.active_assignments),
      lastAssignedAtMs: Number(row.last_assigned_at_ms)
    }));
  }

  getAvailableResponders(nowMs: number): DriverState[] {
    const staleThreshold = nowMs - 20_000;
    const rows = this.db
      .prepare(
        `SELECT * FROM responders
         WHERE status = 'AVAILABLE'
           AND on_duty = 1
           AND available = 1
           AND battery_pct >= 15
           AND last_fix_at_ms >= ?`
      )
      .all(staleThreshold) as Record<string, unknown>[];

    return rows.map((row) => ({
      deviceId: String(row.device_id),
      name: String(row.name),
      status: String(row.status) as DriverState["status"],
      lastLat: Number(row.last_lat),
      lastLng: Number(row.last_lng),
      lastFixAtMs: Number(row.last_fix_at_ms),
      batteryPct: Number(row.battery_pct),
      activeAssignments: Number(row.active_assignments),
      lastAssignedAtMs: Number(row.last_assigned_at_ms)
    }));
  }

  createAssignment(incidentId: string, driverId: string, ackDeadlineMs: number): string {
    const id = uuidv7();
    const now = Date.now();

    this.db.exec("BEGIN;");
    try {
      this.db
        .prepare(
          `INSERT INTO assignments(id, incident_id, driver_id, offer_sent_at_ms, ack_deadline_ms, result)
           VALUES(?, ?, ?, ?, ?, 'PENDING')`
        )
        .run(id, incidentId, driverId, now, ackDeadlineMs);

      this.db
        .prepare(
          "UPDATE responders SET active_assignments = active_assignments + 1, last_assigned_at_ms = ? WHERE device_id = ?"
        )
        .run(now, driverId);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    return id;
  }

  markAssignmentAck(assignmentId: string, ackAtMs: number): void {
    this.db.exec("BEGIN;");
    try {
      const assignment = this.db
        .prepare("SELECT incident_id, driver_id FROM assignments WHERE id = ?")
        .get(assignmentId) as { incident_id: string; driver_id: string } | undefined;
      if (!assignment) {
        this.db.exec("COMMIT;");
        return;
      }

      this.db
        .prepare("UPDATE assignments SET acked_at_ms = ?, result = 'ACKED' WHERE id = ?")
        .run(ackAtMs, assignmentId);
      this.db
        .prepare("UPDATE incidents SET status = 'ASSIGNED', assigned_driver_id = ?, assigned_at_ms = ?, updated_at_ms = ? WHERE id = ?")
        .run(assignment.driver_id, ackAtMs, ackAtMs, assignment.incident_id);
      this.db
        .prepare("UPDATE responders SET active_assignments = CASE WHEN active_assignments > 0 THEN active_assignments - 1 ELSE 0 END, status = 'BUSY' WHERE device_id = ?")
        .run(assignment.driver_id);

      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  markAssignmentRejected(assignmentId: string, reason: string): void {
    this.db.exec("BEGIN;");
    try {
      const assignment = this.db
        .prepare("SELECT incident_id, driver_id FROM assignments WHERE id = ?")
        .get(assignmentId) as { incident_id: string; driver_id: string } | undefined;
      if (!assignment) {
        this.db.exec("COMMIT;");
        return;
      }

      this.db
        .prepare("UPDATE assignments SET result = 'REJECTED', reason = ? WHERE id = ?")
        .run(reason, assignmentId);
      this.db
        .prepare("UPDATE incidents SET status = 'UNASSIGNED_RETRY', updated_at_ms = ? WHERE id = ?")
        .run(Date.now(), assignment.incident_id);
      this.db
        .prepare("UPDATE responders SET active_assignments = CASE WHEN active_assignments > 0 THEN active_assignments - 1 ELSE 0 END, status = 'AVAILABLE' WHERE device_id = ?")
        .run(assignment.driver_id);

      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  expireTimedOutAssignments(nowMs: number): Array<{ assignmentId: string; incidentId: string }> {
    const rows = this.db
      .prepare(
        "SELECT id, incident_id, driver_id FROM assignments WHERE result = 'PENDING' AND ack_deadline_ms <= ?"
      )
      .all(nowMs) as Array<{ id: string; incident_id: string; driver_id: string }>;

    if (rows.length === 0) {
      return [];
    }

    this.db.exec("BEGIN;");
    try {
      for (const row of rows) {
        this.db
          .prepare("UPDATE assignments SET result = 'TIMED_OUT', reason = 'ACK_TIMEOUT' WHERE id = ?")
          .run(row.id);
        this.db
          .prepare("UPDATE incidents SET status = 'UNASSIGNED_RETRY', updated_at_ms = ? WHERE id = ?")
          .run(nowMs, row.incident_id);
        this.db
          .prepare("UPDATE responders SET active_assignments = CASE WHEN active_assignments > 0 THEN active_assignments - 1 ELSE 0 END, status = 'AVAILABLE' WHERE device_id = ?")
          .run(row.driver_id);
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    return rows.map((row) => ({ assignmentId: row.id, incidentId: row.incident_id }));
  }

  listRetryIncidents(nowMs: number): Incident[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM incidents WHERE status = 'UNASSIGNED_RETRY' AND updated_at_ms <= ? ORDER BY updated_at_ms ASC"
      )
      .all(nowMs - 10_000) as Record<string, unknown>[];
    return rows.map((row) => this.mapIncident(row));
  }

  enqueueOutbox(params: {
    messageId: string;
    targetDeviceId: string | null;
    envelopeBlob: Buffer;
    expiresAtMs: number;
    nextAttemptAtMs: number;
  }): void {
    const now = Date.now();

    this.db.exec("BEGIN;");
    try {
      this.db
        .prepare(
          `INSERT INTO outbox(message_id, target_device_id, envelope_blob, attempts, next_attempt_at_ms, expires_at_ms)
           VALUES(?, ?, ?, 0, ?, ?)
           ON CONFLICT(message_id) DO UPDATE SET
             target_device_id = excluded.target_device_id,
             envelope_blob = excluded.envelope_blob,
             next_attempt_at_ms = excluded.next_attempt_at_ms,
             expires_at_ms = excluded.expires_at_ms`
        )
        .run(
          params.messageId,
          params.targetDeviceId,
          params.envelopeBlob,
          params.nextAttemptAtMs,
          params.expiresAtMs
        );

      this.db
        .prepare(
          `INSERT INTO delivery_receipts(message_id, target_device_id, first_sent_ms, retry_count)
           VALUES(?, ?, ?, 0)
           ON CONFLICT(message_id, target_device_id) DO NOTHING`
        )
        .run(params.messageId, params.targetDeviceId, now);

      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  dueOutbox(
    nowMs: number,
    limit = 200
  ): Array<{
    messageId: string;
    targetDeviceId: string | null;
    envelopeBlob: Buffer;
    attempts: number;
    expiresAtMs: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT message_id, target_device_id, envelope_blob, attempts, expires_at_ms
         FROM outbox
         WHERE acked_at_ms IS NULL
           AND expires_at_ms > ?
           AND next_attempt_at_ms <= ?
         ORDER BY next_attempt_at_ms ASC
         LIMIT ?`
      )
      .all(nowMs, nowMs, limit) as Array<{
      message_id: string;
      target_device_id: string | null;
      envelope_blob: Buffer;
      attempts: number;
      expires_at_ms: number;
    }>;

    return rows.map((row) => ({
      messageId: row.message_id,
      targetDeviceId: row.target_device_id,
      envelopeBlob: row.envelope_blob,
      attempts: row.attempts,
      expiresAtMs: row.expires_at_ms
    }));
  }

  recordOutboxAttempt(messageId: string, nextAttemptAtMs: number): void {
    const now = Date.now();

    this.db.exec("BEGIN;");
    try {
      this.db
        .prepare(
          `UPDATE outbox
           SET attempts = attempts + 1,
               next_attempt_at_ms = ?,
               acked_at_ms = NULL
           WHERE message_id = ?`
        )
        .run(nextAttemptAtMs, messageId);

      this.db
        .prepare(
          `UPDATE delivery_receipts
           SET retry_count = retry_count + 1,
               last_retry_ms = ?
           WHERE message_id = ?`
        )
        .run(now, messageId);

      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  expireOutbox(nowMs: number): number {
    const result = this.db
      .prepare("DELETE FROM outbox WHERE acked_at_ms IS NULL AND expires_at_ms <= ?")
      .run(nowMs) as { changes?: number };
    return result.changes ?? 0;
  }

  markOutboxAcked(messageId: string, ackTsMs: number): void {
    this.db.exec("BEGIN;");
    try {
      this.db
        .prepare("UPDATE outbox SET acked_at_ms = ? WHERE message_id = ?")
        .run(ackTsMs, messageId);
      this.db
        .prepare("UPDATE delivery_receipts SET acked_at_ms = ? WHERE message_id = ?")
        .run(ackTsMs, messageId);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  upsertPeer(peer: PeerSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO peers(device_id, role, host, port, transport, last_seen_ms)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           role = excluded.role,
           host = excluded.host,
           port = excluded.port,
           transport = excluded.transport,
           last_seen_ms = excluded.last_seen_ms`
      )
      .run(peer.deviceId, peer.role, peer.host, peer.port, peer.transport, peer.lastSeenMs);
  }

  listPeers(): PeerSnapshot[] {
    const rows = this.db
      .prepare("SELECT * FROM peers ORDER BY last_seen_ms DESC")
      .all() as Record<string, unknown>[];
    return rows.map((row) => ({
      deviceId: String(row.device_id),
      role: String(row.role) as PeerSnapshot["role"],
      host: String(row.host),
      port: Number(row.port),
      transport: String(row.transport) as PeerSnapshot["transport"],
      lastSeenMs: Number(row.last_seen_ms)
    }));
  }

  private mapIncident(row: Record<string, unknown>): Incident {
    return {
      id: String(row.id),
      createdAtMs: Number(row.created_at_ms),
      lat: Number(row.lat),
      lng: Number(row.lng),
      accuracyM: Number(row.accuracy_m),
      status: String(row.status) as IncidentStatus,
      priority: Number(row.priority),
      sourceDeviceId: String(row.source_device_id),
      assignedDriverId: row.assigned_driver_id ? String(row.assigned_driver_id) : null,
      assignedAtMs: row.assigned_at_ms ? Number(row.assigned_at_ms) : null,
      resolvedAtMs: row.resolved_at_ms ? Number(row.resolved_at_ms) : null
    };
  }
}