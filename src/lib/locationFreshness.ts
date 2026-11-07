import type { LocationMessage, LocMessage } from "./peerMessages";
export const LOCATION_FRESH_MS = 15000;
/** A replay keeps the original measurement time; a heartbeat never makes a fix fresh. */
export function freshLocation(message: LocMessage, now: number): LocMessage {
  return message && now - message.t <= LOCATION_FRESH_MS && message.t <= now + 60000 ? message : null;
}
/**
 * Mit küldjünk egy újonnan csatlakozó vagy újra jelentkező szobatársnak.
 * null = a megosztás ki van kapcsolva; undefined = a megosztás be van kapcsolva, de a legutóbbi mérés elavult:
 * ilyenkor semmit sem küldünk, mert a „leállt” jelzés hamis lenne, és a nézőnél törölné a jelölőt és az útvonalat.
 */
export function announcement(latest: LocMessage | undefined, now: number): LocMessage | undefined {
  if (latest == null) return null;
  return freshLocation(latest, now) ?? undefined;
}
export function acceptMeasurement(previous: number | null, message: LocationMessage): boolean {
  return previous === null || message.t > previous;
}