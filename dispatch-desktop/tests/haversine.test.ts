import { describe, expect, it } from "vitest";
import { haversineMeters } from "../src/core/haversine";

describe("haversineMeters", () => {
  it("returns near zero for same point", () => {
    expect(haversineMeters(40, -74, 40, -74)).toBeLessThan(0.001);
  });

  it("matches NYC to LA within tolerance", () => {
    const distance = haversineMeters(40.7128, -74.006, 34.0522, -118.2437);
    expect(distance).toBeGreaterThan(3_900_000);
    expect(distance).toBeLessThan(4_000_000);
  });
});