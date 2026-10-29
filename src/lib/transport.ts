export type TransportMode = "walk" | "bike" | "car";
export type TransportState = { mode: TransportMode; candidate: TransportMode | null; candidateAt: number };
export const TRANSPORT_HOLD_MS = 7000;
export function isTransportMode(value: unknown): value is TransportMode {
  return value === "walk" || value === "bike" || value === "car";
}
/** Speed is in m/s. These are estimates, not vehicle identification. */
export function updateTransport(previous: TransportState, speed: number | null, now: number, manual: TransportMode | null = null): TransportState {
  if (manual) return { mode: manual, candidate: null, candidateAt: now };
  if (speed === null || !Number.isFinite(speed) || speed < 0.8) return { ...previous, candidate: null, candidateAt: now };
  const kmh = speed * 3.6;
  const target: TransportMode = kmh >= 50 ? "car" : kmh >= 20 ? "bike" : "walk";
  if (target === previous.mode) return { ...previous, candidate: null, candidateAt: now };
  if (target !== previous.candidate) return { ...previous, candidate: target, candidateAt: now };
  if (now - previous.candidateAt >= TRANSPORT_HOLD_MS) return { mode: target, candidate: null, candidateAt: now };
  return previous;
}