import { distanceMeters } from "./mapMath";
export type StopState = { anchor: { lat: number; lng: number }; since: number };
export function updateStop(previous: StopState | null, point: { lat: number; lng: number }, speed: number | null, accuracy: number | null, now: number): StopState {
  if (!previous || (speed !== null && speed >= 0.8) || distanceMeters(previous.anchor, point) > Math.max(20, Math.min(accuracy ?? 20, 50))) return { anchor: point, since: now };
  return previous;
}
export function stopLabel(since: number | null | undefined, now: number): string {
  if (!since || now - since < 180000) return "Jelenleg";
  const minutes = Math.floor((now - since) / 60000);
  return minutes < 60 ? `${minutes} perce` : `${Math.floor(minutes / 60)} órája`;
}