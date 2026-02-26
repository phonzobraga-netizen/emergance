import { DriverCandidate, DriverState, Incident } from "./types";
import { haversineMeters } from "./haversine";

export class AssignmentEngine {
  chooseDriver(incident: Incident, candidates: DriverState[]): DriverCandidate | null {
    const eligible = candidates.filter((driver) => {
      return (
        driver.status === "AVAILABLE" &&
        driver.lastFixAtMs >= Date.now() - 20_000 &&
        driver.batteryPct >= 15
      );
    });

    if (eligible.length === 0) {
      return null;
    }

    const ranked = eligible
      .map((driver) => ({
        driver,
        distanceMeters: haversineMeters(incident.lat, incident.lng, driver.lastLat, driver.lastLng)
      }))
      .sort((a, b) => {
        if (a.distanceMeters !== b.distanceMeters) {
          return a.distanceMeters - b.distanceMeters;
        }
        if (a.driver.activeAssignments !== b.driver.activeAssignments) {
          return a.driver.activeAssignments - b.driver.activeAssignments;
        }
        return a.driver.lastAssignedAtMs - b.driver.lastAssignedAtMs;
      });

    return ranked[0] ?? null;
  }
}