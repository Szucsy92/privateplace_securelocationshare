import { distanceMeters, bearingDegrees, type LatLngPoint } from "./mapMath";

/**
 * Saját helyek: a felhasználó megnevez egy helyet (pl. „Szoba”), kijelöli rajta, hol áll valójában (pont),
 * és az app megtanulja, mennyit téved ott a telefon GPS-e. Legközelebb, ha a nyers pozíció ugyanott áll,
 * a jelölő a valódi helyet mutatja. Minden adat csak ezen a telefonon marad (localStorage).
 */
export type Bias = { e: number; n: number };
export type Spot = {
  id: string;
  label: string;
  /** A kijelölt, valódi hely. */
  lat: number;
  lng: number;
  /** A tanult eltérés (nyers − valódi), méterben; null = még nem tanult. */
  bias: Bias | null;
  learnedAt: number | null;
  samples: number;
};
export type Place = { id: string; name: string; icon: string; note: string; radius: number; spots: Spot[]; createdAt: number };
export type FixLite = LatLngPoint & { acc: number | null };

export const PLACES_KEY = "privateplace.places.v1";
export const MIN_RADIUS = 5;
export const MAX_RADIUS = 100;
export const DEFAULT_RADIUS = 20;
const MAX_PLACES = 50;
const MAX_SPOTS = 20;
const MAX_BIAS_M = 60;
const LEARN_MIN_FIXES = 8;
const LEARN_MAX_SPREAD_M = 3;
const LEARN_MAX_ACC_M = 15;
const M_PER_DEG = 111320;

export const newId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export function offsetPoint(p: LatLngPoint, e: number, n: number): LatLngPoint {
  return { lat: p.lat + n / M_PER_DEG, lng: p.lng + e / (M_PER_DEG * Math.max(0.01, Math.cos((p.lat * Math.PI) / 180))) };
}
/** a → b vektora méterben (kelet, észak). */
export function localVector(a: LatLngPoint, b: LatLngPoint): Bias {
  return { e: (b.lng - a.lng) * M_PER_DEG * Math.cos((a.lat * Math.PI) / 180), n: (b.lat - a.lat) * M_PER_DEG };
}
export function medianPoint(points: LatLngPoint[]): LatLngPoint | null {
  if (!points.length) return null;
  const med = (v: number[]) => { const s = [...v].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
  return { lat: med(points.map((p) => p.lat)), lng: med(points.map((p) => p.lng)) };
}

export function newPlace(name: string): Place {
  return { id: newId(), name: name.trim().slice(0, 60) || "Új hely", icon: "", note: "", radius: DEFAULT_RADIUS, spots: [], createdAt: Date.now() };
}
export function newSpot(at: LatLngPoint, label = ""): Spot {
  return { id: newId(), label: label.slice(0, 60), lat: at.lat, lng: at.lng, bias: null, learnedAt: null, samples: 0 };
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
export function sanitizePlaces(raw: unknown): Place[] {
  if (!Array.isArray(raw)) return [];
  const out: Place[] = [];
  for (const r of raw.slice(0, MAX_PLACES)) {
    if (!r || typeof r !== "object") continue;
    const p = r as Partial<Place>;
    if (typeof p.id !== "string" || typeof p.name !== "string") continue;
    const spots: Spot[] = [];
    for (const s of Array.isArray(p.spots) ? p.spots.slice(0, MAX_SPOTS) : []) {
      if (!s || typeof s !== "object") continue;
      const q = s as Partial<Spot>;
      if (typeof q.id !== "string" || !finite(q.lat) || !finite(q.lng) || Math.abs(q.lat) > 90 || Math.abs(q.lng) > 180) continue;
      const b = q.bias;
      const bias = b && finite(b.e) && finite(b.n) && Math.hypot(b.e, b.n) <= MAX_BIAS_M ? { e: b.e, n: b.n } : null;
      spots.push({ id: q.id, label: typeof q.label === "string" ? q.label.slice(0, 60) : "", lat: q.lat, lng: q.lng, bias, learnedAt: bias && finite(q.learnedAt) ? q.learnedAt : null, samples: bias && finite(q.samples) ? q.samples : 0 });
    }
    out.push({
      id: p.id,
      name: p.name.slice(0, 60),
      icon: typeof p.icon === "string" ? p.icon.slice(0, 8) : "",
      note: typeof p.note === "string" ? p.note.slice(0, 200) : "",
      radius: finite(p.radius) ? Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, p.radius)) : DEFAULT_RADIUS,
      spots,
      createdAt: finite(p.createdAt) ? p.createdAt : 0,
    });
  }
  return out;
}
export function loadPlaces(): Place[] {
  try { const raw = localStorage.getItem(PLACES_KEY); return raw ? sanitizePlaces(JSON.parse(raw)) : []; } catch { return []; }
}
export function savePlaces(places: Place[]) {
  try { localStorage.setItem(PLACES_KEY, JSON.stringify(places)); } catch { /* nem kritikus */ }
}

/** A kijelölt pont pontosítása: eltolás méterben (kelet, észak). A tanult eltérés a nyers értékhez tartozik, ezért a pont mozgatásakor újra kell tanulni. */
export function nudgeSpot(s: Spot, de: number, dn: number): Spot {
  const p = offsetPoint(s, de, dn);
  return { ...s, lat: p.lat, lng: p.lng, bias: null, learnedAt: null, samples: 0 };
}

export type LearnResult = { ok: true; spot: Spot } | { ok: false; reason: "kevés fix" | "pontatlan" | "mozgás" | "nagy eltérés" };
/** Tanulás: a legutóbbi (korrekció előtti) fixek mediánja és a kijelölt valódi pont különbsége. Csak álló, elég pontos fixekből. */
export function learnBias(s: Spot, recent: FixLite[], now = Date.now()): LearnResult {
  const good = recent.filter((f) => f.acc == null || f.acc <= LEARN_MAX_ACC_M);
  if (good.length < LEARN_MIN_FIXES) return { ok: false, reason: recent.length < LEARN_MIN_FIXES ? "kevés fix" : "pontatlan" };
  const c = medianPoint(good)!;
  const spread = Math.sqrt(good.reduce((a, f) => { const d = distanceMeters(f, c); return a + d * d; }, 0) / good.length);
  if (spread > LEARN_MAX_SPREAD_M) return { ok: false, reason: "mozgás" };
  const bias = localVector(s, c);
  if (Math.hypot(bias.e, bias.n) > MAX_BIAS_M) return { ok: false, reason: "nagy eltérés" };
  return { ok: true, spot: { ...s, bias, learnedAt: now, samples: good.length } };
}

export type Applied = { point: LatLngPoint; placeId: string | null; spotId: string | null; shiftM: number };
/**
 * Korrekció: ha a (szűrt) pozíció a tanult nyers pont közelében van, a tanult eltérés lágyan kikerül belőle.
 * A súly a távolsággal lineárisan csökken (a hely sugaránál 0), ezért nincs ugrás a szélénél.
 */
export function applyPlaces(places: Place[], p: LatLngPoint): Applied {
  let best: { w: number; place: Place; spot: Spot; bias: Bias } | null = null;
  for (const place of places) {
    for (const spot of place.spots) {
      if (!spot.bias) continue;
      const expected = offsetPoint(spot, spot.bias.e, spot.bias.n);
      const w = 1 - distanceMeters(p, expected) / place.radius;
      if (w > 0 && (!best || w > best.w)) best = { w, place, spot, bias: spot.bias };
    }
  }
  if (!best) return { point: p, placeId: null, spotId: null, shiftM: 0 };
  const point = offsetPoint(p, -best.bias.e * best.w, -best.bias.n * best.w);
  return { point, placeId: best.place.id, spotId: best.spot.id, shiftM: Math.hypot(best.bias.e, best.bias.n) * best.w };
}

const DIRS = ["É", "ÉK", "K", "DK", "D", "DNy", "Ny", "ÉNy"];
export const compass = (deg: number) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
/** „6,8 m ÉK” alakú felirat az a → b vektorra. */
export function describeVector(a: LatLngPoint, b: LatLngPoint): string {
  const d = distanceMeters(a, b);
  return d < 0.5 ? "egyezik" : `${d.toFixed(1).replace(".", ",")} m ${compass(bearingDegrees(a, b))}`;
}
