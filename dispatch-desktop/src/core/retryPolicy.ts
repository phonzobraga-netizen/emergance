const RETRY_SEQUENCE_MS = [500, 1000, 2000, 4000, 8000, 16000];

export function nextRetryDelayMs(attemptsCompleted: number): number {
  if (attemptsCompleted < RETRY_SEQUENCE_MS.length) {
    return RETRY_SEQUENCE_MS[attemptsCompleted];
  }
  return 30_000;
}

export function ttlByMessageType(type: string): number {
  switch (type) {
    case "SOS_CREATE":
      return 86_400_000;
    case "ASSIGNMENT_OFFER":
      return 60_000;
    case "DRIVER_HEARTBEAT":
      return 15_000;
    default:
      return 60_000;
  }
}