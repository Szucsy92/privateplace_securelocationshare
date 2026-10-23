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

/** Távolság méterben (haversine). */
export function distanceMeters(a: LatLngPoint, b: LatLngPoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Szögkülönbség a legrövidebb irányban (-180..180). */
export function angleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Lágy közelítés a cél szöghöz, a rövidebb irányba fordulva. */
export function smoothAngle(current: number, target: number, factor: number): number {
  return current + angleDelta(current, target) * Math.min(1, Math.max(0, factor));
}

/** Haladási irány az utolsó, legalább minMeters-re lévő pontpár alapján. */
export function headingFromTrack(points: LatLngPoint[], minMeters = 3): number | null {
  const last = points[points.length - 1];
  if (!last) return null;
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i];
    if (p && distanceMeters(p, last) >= minMeters) return bearingDegrees(p, last);
  }
  return null;
}
