import { encodeEnvelope } from "./protocol";
import { Envelope } from "./types";
import { DispatchDatabase } from "../db/database";

export class ReliabilityStore {
  constructor(private readonly db: DispatchDatabase) {}

  enqueue(envelope: Envelope, targetDeviceId: string | null, expiresAtMs: number): void {
    this.db.enqueueOutbox({
      messageId: envelope.messageId,
      targetDeviceId,
      envelopeBlob: encodeEnvelope(envelope),
      expiresAtMs,
      nextAttemptAtMs: Date.now()
    });
  }

  markAcked(messageId: string, ackTs: number): void {
    this.db.markOutboxAcked(messageId, ackTs);
  }
}