import type { LocationMessage, LocMessage } from "./peerMessages";
export const LOCATION_FRESH_MS = 15000;
/** A replay keeps the original measurement time; a heartbeat never makes a fix fresh. */
export function freshLocation(message: LocMessage, now: number): LocMessage {
  return message && now - message.t <= LOCATION_FRESH_MS && message.t <= now + 60000 ? message : null;
}
export function acceptMeasurement(previous: number | null, message: LocationMessage): boolean {
  return previous === null || message.t > previous;
}