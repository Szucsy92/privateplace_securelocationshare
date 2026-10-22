export type LatLngPoint = { lat: number; lng: number };

/** Irányszög (fok, 0 = észak, óramutató járása szerint) két pont között. */
export function bearingDegrees(a: LatLngPoint, b: LatLngPoint): number {
  const fi1 = (a.lat * Math.PI) / 180;
  const fi2 = (b.lat * Math.PI) / 180;
  const dLambda = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(fi2);
  const x = Math.cos(fi1) * Math.sin(fi2) - Math.sin(fi1) * Math.cos(fi2) * Math.cos(dLambda);
  const theta = (Math.atan2(y, x) * 180) / Math.PI;
  return (theta + 360) % 360;
}

/** Lineáris interpoláció két pont között, k ∈ [0,1]. */
export function lerpPoint(a: LatLngPoint, b: LatLngPoint, k: number): LatLngPoint {
  const t = Math.min(1, Math.max(0, k));
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Animációs időtartam két GPS-pont időköze alapján (ms), ésszerű határok között. */
export function animationDurationMs(prevT: number | null, nextT: number): number {
  if (prevT == null) return 800;
  return Math.min(Math.max(nextT - prevT, 400), 2000);
}
