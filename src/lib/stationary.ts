import { distanceMeters, type LatLngPoint } from "./mapMath";

/* ------------------------------------------------------------------ */
/* Megállás-időzítő (a MapApp és a PersonBubble ezt a szerződést várja) */
/* ------------------------------------------------------------------ */

export type StopState = { anchor: LatLngPoint; since: number };

/** Ennél gyorsabb haladás biztosan mozgás (m/s). */
export const MOVING_SPEED = 0.8;
/** Ennél rosszabb pontosságú fixből nem döntünk a megállásról (m). */
const UNRELIABLE_ACC = 50;

/** Megállási sugár: a GPS-zaj mértéke (pontosság), 10 és 40 m között. */
function stopRadius(acc: number | null): number {
  return Math.min(40, Math.max(10, acc ?? 10));
}

/**
 * Megállás követése. A `since` csak akkor indul újra, ha valódi mozgás van: ismert sebesség a küszöb fölött,
 * vagy a pont a horgonytól a GPS-zajnál messzebb került. Kis sodródás nem indítja újra az órát.
 */
export function updateStop(prev: StopState | null, point: LatLngPoint, speed: number | null, acc: number | null, at: number): StopState {
  const fresh: StopState = { anchor: { lat: point.lat, lng: point.lng }, since: at };
  if (!prev) return fresh;
  if (speed !== null && speed > MOVING_SPEED) return fresh;
  if (acc !== null && acc > UNRELIABLE_ACC) return prev;
  return distanceMeters(prev.anchor, point) <= stopRadius(acc) ? prev : fresh;
}

/** Rövid felirat a megállás idejéről; üres, ha nincs megállás. */
export function stopLabel(since: number | null | undefined, now: number): string {
  if (since == null) return "";
  const minutes = Math.floor(Math.max(0, now - since) / 60000);
  if (minutes < 1) return "most állt meg";
  if (minutes < 60) return `${minutes} perce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} órája`;
  return `${Math.floor(hours / 24)} napja`;
}

/* ------------------------------------------------------------------ */
/* Drift-szűrő: a helyben álló jelölő ne vándoroljon a GPS-zaj miatt   */
/* ------------------------------------------------------------------ */

export type RawFix = { lat: number; lng: number; acc: number | null; speed: number | null; bearing?: number | null; at?: number };

const HOLD_BAD_ACC = 60;      // m: ennél pontatlanabb fixet eldobunk, ha van friss jó
const GOOD_FIX_MS = 20000;    // ennyi ideig számít "frissnek" az utolsó jó fix
const BREAKOUT_FIXES = 3;     // ennyi egymást követő, a sugáron kívüli fix kell az elmozduláshoz
const STILL_SPEED = 0.6;      // m/s: e fölött már nem tekintjük állónak

/**
 * Állapotos szűrő. Minden nyers fixet átad, de:
 *  1. rossz pontosságú fixet (pl. hálózati) nem engedi felülírni egy friss, jó fixet;
 *  2. álló helyzetben (sebesség ~0, a GPS-zaj sugarán belül) a horgony pontját adja vissza, így nincs vándorlás;
 *  3. kitörés csak tartós elmozdulásra (több egymás utáni fix) vagy ismert gyors haladásra történik.
 */
export function createDriftFilter() {
  let anchor: (LatLngPoint & { acc: number | null }) | null = null;
  let strikes = 0;
  let lastGood: { at: number; acc: number } | null = null;
  let last: RawFix | null = null;

  return function filter(fix: RawFix): RawFix {
    const at = fix.at ?? Date.now();

    // 1) Pontatlan fix nem rontja el a jó pozíciót.
    if (fix.acc !== null && fix.acc > HOLD_BAD_ACC && last && lastGood && at - lastGood.at < GOOD_FIX_MS) {
      return { ...last, at };
    }
    if (fix.acc !== null && fix.acc <= HOLD_BAD_ACC) lastGood = { at, acc: fix.acc };

    // 2) Sebesség: ha a készülék nem adja, a két fix közötti átlagból becsüljük (csak értelmes időköznél).
    let speed = fix.speed;
    if (speed === null && last && last.at !== undefined && at - last.at >= 1000) {
      speed = distanceMeters(last, fix) / ((at - last.at) / 1000);
    }

    const moving = speed !== null && speed > MOVING_SPEED;
    if (moving) {
      anchor = null;
      strikes = 0;
      last = { ...fix, speed, at };
      return last;
    }

    if (!anchor) {
      anchor = { lat: fix.lat, lng: fix.lng, acc: fix.acc };
      last = { ...fix, at };
      return last;
    }

    const radius = stopRadius(fix.acc);
    if (distanceMeters(anchor, fix) <= radius && (speed === null || speed <= STILL_SPEED || distanceMeters(anchor, fix) <= radius / 2)) {
      strikes = 0;
      last = { ...fix, lat: anchor.lat, lng: anchor.lng, speed: 0, bearing: last?.bearing ?? fix.bearing ?? null, at };
      return last;
    }

    // A horgonyon kívül: egyetlen kiugró fixet visszatartunk, tartós elmozdulásnál új horgony.
    strikes += 1;
    if (strikes >= BREAKOUT_FIXES) {
      anchor = { lat: fix.lat, lng: fix.lng, acc: fix.acc };
      strikes = 0;
      last = { ...fix, at };
      return last;
    }
    last = { ...fix, lat: anchor.lat, lng: anchor.lng, speed: 0, bearing: last?.bearing ?? fix.bearing ?? null, at };
    return last;
  };
}
