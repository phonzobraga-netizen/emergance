import { describe, expect, it } from "vitest";
import { nextRetryDelayMs, ttlByMessageType } from "../src/core/retryPolicy";

describe("retryPolicy", () => {
  it("follows exponential schedule then flat interval", () => {
    expect(nextRetryDelayMs(0)).toBe(500);
    expect(nextRetryDelayMs(1)).toBe(1000);
    expect(nextRetryDelayMs(2)).toBe(2000);
    expect(nextRetryDelayMs(5)).toBe(16000);
    expect(nextRetryDelayMs(6)).toBe(30000);
    expect(nextRetryDelayMs(9)).toBe(30000);
  });

  it("provides ttl defaults", () => {
    expect(ttlByMessageType("SOS_CREATE")).toBe(86_400_000);
    expect(ttlByMessageType("ASSIGNMENT_OFFER")).toBe(60_000);
    expect(ttlByMessageType("DRIVER_HEARTBEAT")).toBe(15_000);
  });
});