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
/* Drift-szűrő: helyben állva a jelölő ne vándoroljon a GPS-zaj miatt,  */
/* induláskor viszont azonnal kövesse a mozgást.                        */
/* ------------------------------------------------------------------ */

/*
 * Két állapot:
 *  - ÁLLÁS: a kimenet egy lassan finomodó horgony (pontossággal súlyozott átlag). A megtartási sugarat a szűrő a
 *    ténylegesen mért szórásból tanulja, nem a (túl optimista) jelentett pontosságból. Kilépés: a Doppler-sebesség
 *    (független a pozíciószórástól) két fixen át ≥ 1 m/s, vagy tartós, egy irányba mutató elmozdulás.
 *  - MOZGÁS: állandó sebesség modellű Kalman-szűrő, a Doppler-sebességgel és -iránnyal is javítva, így nincs késés és kevés a zaj.
 * Belépés az állásba: ~5 s (Doppler nélkül 10 s) egybefüggő „áll” bizonyíték.
 */
export type RawFix = { lat: number; lng: number; acc: number | null; speed: number | null; bearing?: number | null; at?: number };

/* ---- Hangolható állandók ------------------------------------------------------------------------------ */
const BAD_ACC = 60;            // m: ennél pontatlanabb fixet eldobunk, ha van friss jó
const GOOD_FIX_MS = 20000;     // ennyi ideig számít frissnek az utolsó jó fix
const ACC_FLOOR = 6;           // m: a jelentett pontosságot ennél jobbnak nem hisszük el
const ACC_TRUST = 1.3;         // a jelentett pontosság szorzója (a telefon többnyire túl optimista)
const STILL_SPEED = 0.5;       // m/s: ennél lassabb Doppler-sebesség „áll” bizonyíték
const GO_SPEED = 1.0;          // m/s: két egymást követő fix ennél gyorsabb -> mozgás
const GO_SPEED_NOW = 2.0;      // m/s: egyetlen ennél gyorsabb fix is elég
const ENTER_MS = 5000;         // ennyi ideig kell „állónak” látszania a belépéshez
const ENTER_FIXES = 4;         // és legalább ennyi fixből
const GATE_MIN = 10, GATE_MAX = 80; // m: a megtartási sugár határai
const GATE_K = 2.2;            // a megtartási sugár = ennyiszer a mért szórás (RMS)
const ANCHOR_WEIGHT_CAP = 0.8; // a horgony „memóriája” (kb. 40 jó fix): lassan követi a valódi helyet
const SHOW_STEP = 4;           // m: a megjelenített pont csak ekkora horgonymozdulásnál lép (nincs mikro-remegés)
const SIGMA_A_MIN = 0.8, SIGMA_A_MAX = 4; // m/s²: a Kalman-szűrő folyamatzaja (gyalogos … autó)

type Vec = { x: number; y: number };
type Axis = { p: number; v: number; Ppp: number; Ppv: number; Pvv: number };
const M_LAT = 110540;

export function createDriftFilter() {
  let lat0 = 0, lng0 = 0, haveOrigin = false;
  const toXY = (lat: number, lng: number): Vec => ({ x: (lng - lng0) * Math.cos((lat0 * Math.PI) / 180) * 111320, y: (lat - lat0) * M_LAT });
  const toLL = (v: Vec): LatLngPoint => ({ lat: lat0 + v.y / M_LAT, lng: lng0 + v.x / (Math.cos((lat0 * Math.PI) / 180) * 111320) });

  let mode: "init" | "moving" | "still" = "init";
  let kx: Axis | null = null, ky: Axis | null = null;
  let lastAt: number | null = null;
  let last: RawFix | null = null;
  let lastGood: number | null = null;
  let lastBearing: number | null = null;

  // „állás” állapot
  let anchor: Vec = { x: 0, y: 0 }, anchorW = 0, shown: Vec = { x: 0, y: 0 };
  let rms2 = 100;                // a horgonytól mért távolságnégyzet mozgóátlaga (m²)
  let outside = 0, fastCount = 0;
  let recent: { p: Vec; w: number; at: number; speed: number | null }[] = [];

  const newAxis = (p: number, v: number, pp: number, pv: number): Axis => ({ p, v, Ppp: pp, Ppv: 0, Pvv: pv });
  const predict = (a: Axis, dt: number, sa: number) => {
    const q = sa * sa;
    a.p += a.v * dt;
    const Ppp = a.Ppp + 2 * dt * a.Ppv + dt * dt * a.Pvv + (q * dt ** 4) / 4;
    const Ppv = a.Ppv + dt * a.Pvv + (q * dt ** 3) / 2;
    const Pvv = a.Pvv + q * dt * dt;
    a.Ppp = Ppp; a.Ppv = Ppv; a.Pvv = Pvv;
  };
  const updPos = (a: Axis, z: number, R: number) => {
    const S = a.Ppp + R, Kp = a.Ppp / S, Kv = a.Ppv / S, y = z - a.p;
    a.p += Kp * y; a.v += Kv * y;
    const Ppp = (1 - Kp) * a.Ppp, Ppv = (1 - Kp) * a.Ppv, Pvv = a.Pvv - Kv * a.Ppv;
    a.Ppp = Ppp; a.Ppv = Ppv; a.Pvv = Pvv;
  };
  const updVel = (a: Axis, z: number, R: number) => {
    const S = a.Pvv + R, Kp = a.Ppv / S, Kv = a.Pvv / S, y = z - a.v;
    a.p += Kp * y; a.v += Kv * y;
    const Ppp = a.Ppp - Kp * a.Ppv, Ppv = a.Ppv - Kp * a.Pvv, Pvv = a.Pvv - Kv * a.Pvv;
    a.Ppp = Ppp; a.Ppv = Ppv; a.Pvv = Pvv;
  };

  const wmean = (pts: { p: Vec; w: number }[]): Vec => {
    let sw = 0, sx = 0, sy = 0;
    for (const q of pts) { sw += q.w; sx += q.p.x * q.w; sy += q.p.y * q.w; }
    return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: 0, y: 0 };
  };

  function toMoving(pos: Vec, at: number) {
    mode = "moving";
    kx = newAxis(pos.x, 0, 25, 4); ky = newAxis(pos.y, 0, 25, 4);
    outside = 0; fastCount = 0; recent = [];
    lastAt = at;
  }
  function toStill(pos: Vec, spread2: number) {
    mode = "still";
    anchor = { ...pos }; shown = { ...pos }; anchorW = ANCHOR_WEIGHT_CAP / 2;
    rms2 = Math.max(spread2, 36);
    outside = 0; fastCount = 0;
  }
  const gate = (sigma: number) => Math.min(GATE_MAX, Math.max(GATE_MIN, GATE_K * Math.sqrt(rms2), 1.2 * sigma));

  return function filter(fix: RawFix): RawFix {
    const at = fix.at ?? Date.now();

    // 1) Pontatlan fix nem ronthatja el a friss, jó pozíciót.
    if (fix.acc !== null && fix.acc > BAD_ACC && last && lastGood !== null && at - lastGood < GOOD_FIX_MS) return { ...last, at };
    if (fix.acc === null || fix.acc <= BAD_ACC) lastGood = at;

    if (!haveOrigin) { lat0 = fix.lat; lng0 = fix.lng; haveOrigin = true; }
    const z = toXY(fix.lat, fix.lng);
    const sigma = Math.max(ACC_FLOOR, (fix.acc ?? 15) * ACC_TRUST);
    const w = 1 / (sigma * sigma);
    const dt = lastAt === null ? 1 : Math.min(30, Math.max(0.2, (at - lastAt) / 1000));
    const sp = fix.speed;
    if (fix.bearing != null && Number.isFinite(fix.bearing) && (sp === null || sp > 1)) lastBearing = fix.bearing;

    if (mode === "init") {
      toMoving(z, at);
      lastAt = at;
      last = { ...fix, at };
      return last;
    }

    /* ---------- ÁLLÁS ---------- */
    if (mode === "still") {
      const d = Math.hypot(z.x - anchor.x, z.y - anchor.y);
      const g = gate(sigma);
      recent.push({ p: z, w, at, speed: sp });
      if (recent.length > 4) recent.shift();

      // Gyors kilépés: a Doppler-sebesség a pozíciószóráson kívüli, független bizonyíték a mozgásra.
      if (sp !== null && sp >= GO_SPEED_NOW) fastCount = 2;
      else if (sp !== null && sp >= GO_SPEED) fastCount += 1;
      else fastCount = 0;

      // Lassú kilépés: tartós, egy irányba mutató elmozdulás (a szórás nem ilyen).
      let leave = fastCount >= 2;
      if (!leave) {
        // Doppler nélkül (pl. böngésző) a sugár 70%-ánál már számolunk: a tartós, egyirányú elmozdulás nem szórás.
        const g2 = sp === null ? 0.7 * g : g;
        if (d > g2) outside += 1; else outside = 0;
        if (outside >= 3 && recent.length >= 3) {
          const c = wmean(recent.slice(-3));
          const dir = { x: c.x - anchor.x, y: c.y - anchor.y };
          const dl = Math.hypot(dir.x, dir.y) || 1;
          const consistent = recent.slice(-3).every((r) => ((r.p.x - anchor.x) * dir.x + (r.p.y - anchor.y) * dir.y) / dl > 0.5 * g2);
          leave = dl > g2 && consistent;
        }
        if (!leave && d > 4 * g && outside >= 2) leave = true; // nagy, tartós ugrás
      }
      if (leave) {
        const c = wmean(recent.slice(-3));
        toMoving(fastCount >= 2 ? z : c, at);
        // kezdősebesség: ha van Doppler-adat, abból
        if (sp !== null && fix.bearing != null && sp >= GO_SPEED) {
          const b = (fix.bearing * Math.PI) / 180;
          kx!.v = sp * Math.sin(b); ky!.v = sp * Math.cos(b);
        }
        lastAt = at;
        const pos = toLL({ x: kx!.p, y: ky!.p });
        last = { ...fix, ...pos, at };
        return last;
      }

      // Marad: csak a gate-en belüli fix finomítja a horgonyt (súlyozott, korlátos memóriával).
      if (d <= g) {
        const tot = anchorW + w, k = w / tot;
        anchor = { x: anchor.x + (z.x - anchor.x) * k, y: anchor.y + (z.y - anchor.y) * k };
        anchorW = Math.min(tot, ANCHOR_WEIGHT_CAP);
        rms2 = 0.97 * rms2 + 0.03 * Math.min(d * d, (GATE_MAX) ** 2); // a valódi szórást tanulja
      }
      if (Math.hypot(anchor.x - shown.x, anchor.y - shown.y) >= SHOW_STEP) shown = { ...anchor };
      lastAt = at;
      last = { ...fix, ...toLL(shown), speed: 0, bearing: lastBearing, at };
      return last;
    }

    /* ---------- MOZGÁS (Kalman, állandó sebesség modell) ---------- */
    const kxx = kx!, kyy = ky!;
    const v = Math.hypot(kxx.v, kyy.v);
    const sa = Math.min(SIGMA_A_MAX, Math.max(SIGMA_A_MIN, 0.5 + 0.35 * v));
    predict(kxx, dt, sa); predict(kyy, dt, sa);
    updPos(kxx, z.x, sigma * sigma); updPos(kyy, z.y, sigma * sigma);
    if (sp !== null) {
      if (sp >= 0.7 && fix.bearing != null && Number.isFinite(fix.bearing)) {
        const b = (fix.bearing * Math.PI) / 180, R = 0.8 * 0.8 + (0.15 * sp) ** 2;
        updVel(kxx, sp * Math.sin(b), R); updVel(kyy, sp * Math.cos(b), R);
      } else if (sp < STILL_SPEED) {
        updVel(kxx, 0, 0.3 * 0.3); updVel(kyy, 0, 0.3 * 0.3); // „nulla sebesség” frissítés
      }
    }

    // Belépés az állásba: elég hosszan és elég fixből is álló bizonyíték.
    recent.push({ p: z, w, at, speed: sp });
    if (recent.length > 24) recent.shift();
    const longWin = sp === null ? 10000 : ENTER_MS;
    const wnd = recent.filter((r) => at - r.at <= longWin);
    const spanOk = wnd.length >= ENTER_FIXES && at - wnd[0].at >= longWin * 0.8;
    if (spanOk) {
      const slow = wnd.every((r) => r.speed === null || r.speed <= STILL_SPEED + 0.3);
      const c = wmean(wnd);
      const rms = Math.sqrt(wnd.reduce((s, r) => s + (r.p.x - c.x) ** 2 + (r.p.y - c.y) ** 2, 0) / wnd.length);
      const half = Math.floor(wnd.length / 2);
      const c1 = wmean(wnd.slice(0, half)), c2 = wmean(wnd.slice(half));
      const halves = Math.hypot(c1.x - c2.x, c1.y - c2.y);
      const doppler = wnd.every((r) => r.speed !== null);
      if (slow && rms <= (doppler ? 60 : 45) && (doppler || halves <= 1.2 * rms + 5)) {
        toStill(c, rms * rms);
        lastAt = at;
        last = { ...fix, ...toLL(shown), speed: 0, bearing: lastBearing, at };
        return last;
      }
    }

    lastAt = at;
    const pos = toLL({ x: kxx.p, y: kyy.p });
    const spd = Math.hypot(kxx.v, kyy.v);
    const bearing = spd >= 1 ? ((Math.atan2(kxx.v, kyy.v) * 180) / Math.PI + 360) % 360 : fix.bearing ?? lastBearing;
    last = { ...fix, ...pos, speed: sp ?? spd, bearing, at };
    return last;
  };
}
