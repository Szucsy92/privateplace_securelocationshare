export const TRAIL_MS = 30 * 60 * 1000;

export function clearTrackHistory<T>(points: T[]): T[] {
  const current = points[points.length - 1];
  return current === undefined ? [] : [current];
}

export function shouldPublishLocation(sharing: boolean, now: number, lastSent: number) {
  return sharing && now - lastSent >= 1000;
}

export function appendTrackPoint<T extends { t: number }>(points: T[], point: T, now: number): T[] {
  return [...points, point].filter((p) => p.t >= now - TRAIL_MS);
}
