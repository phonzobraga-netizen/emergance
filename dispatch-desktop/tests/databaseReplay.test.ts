import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { DispatchDatabase } from "../src/db/database";

describe("DispatchDatabase replay and outbox", () => {
  it("tracks processed messages and ack", () => {
    const file = path.join(os.tmpdir(), `emergance-test-${Date.now()}.db`);
    const db = new DispatchDatabase(file);

    expect(db.hasProcessedMessage("m1")).toBe(false);
    db.markProcessedMessage("m1", Date.now());
    expect(db.hasProcessedMessage("m1")).toBe(true);

    db.enqueueOutbox({
      messageId: "m1",
      targetDeviceId: "d1",
      envelopeBlob: Buffer.from([1, 2, 3]),
      nextAttemptAtMs: Date.now() - 1,
      expiresAtMs: Date.now() + 10_000
    });

    const due = db.dueOutbox(Date.now(), 10);
    expect(due.length).toBe(1);

    db.markOutboxAcked("m1", Date.now());
    const dueAfterAck = db.dueOutbox(Date.now(), 10);
    expect(dueAfterAck.length).toBe(0);

    db.close();
    fs.rmSync(file, { force: true });
  });
});