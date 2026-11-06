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
export function stopLabel(since: number | null | undefined, now: number, moving = false): string {
  if (moving) return "mozgásban";
  if (since == null) return "";
  const minutes = Math.floor(Math.max(0, now - since) / 60000);
  if (minutes < 1) return "most állt meg";
  if (minutes < 60) return `${minutes} perce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} órája`;
  return `${Math.floor(hours / 24)} napja`;
}

/* ------------------------------------------------------------------ */
/* Drift-szűrő v2: „horgony + bizonyíték” állapotgép                    */
/* ------------------------------------------------------------------ */

/*
 * Alapelv: a pozíció zajos és sodródik, a Doppler-sebesség viszont a pozíciózajtól FÜGGETLEN bizonyíték.
 *  - ÁLLÁS: a kimenet egy pontossággal súlyozott, lassan finomodó horgony. Kilépés csak bizonyítékkal:
 *      a) Doppler ≥ 0,8 m/s (vagy járás-jelzés, ha a Doppler nem mond ellent) az utolsó 3 fixből kettőn; ≥ 2,5 m/s egyen is – az egyedi sebességtüske nem indít;
 *      b) sebességadat nélkül: tartós, egyirányú elmozdulás a tanult zajszint többszöröse fölé;
 *      c) „távoli klaszter”: ha a Doppler végig áll-t mond, a pozíció-ugrás (multipath) csak 45 s tartós elmozdulás után fogadódik el.
 *  - MOZGÁS: állandó sebesség modellű Kalman-szűrő, a HORGONYBÓL indítva (nem a nyers fixből), Doppler-sebességgel javítva.
 *  - A `stoppedSince` ugyanebből az állapotgépből jön, a bizonyíték kezdetére visszadátumozva – nincs külön megállás-detektor.
 */
export type RawFix = {
  lat: number; lng: number; acc: number | null; speed: number | null; speedAcc?: number | null; bearing?: number | null; at?: number; src?: "gps" | "network";
  /** Független mozgásjelzés (gyorsulásmérő/lépésérzékelő): igaz, ha az utóbbi ~3 s-ban járás-szerű mozgás volt. */
  stepping?: boolean;
};
export type FilteredFix = RawFix & { mode: "still" | "moving"; stoppedSince: number | null };

/* ---- Hangolható állandók ------------------------------------------------------------------------------ */
const SAT_ACC = 20;            // m: ennél pontosabb (és nem hálózati) fix „műholdas minőségű”
const ROUGH_ACC = 30;          // m: ennél pontatlanabb vagy ismeretlen pontosságú fix „durva”
const SAT_FRESH_MS = 22000;    // ennyi ideig friss a műholdas fix; ennyi csend után a durva fix is átjut
const INIT_ROUGH_MS = 8000;    // induláskor ennyit várunk jó fixre, mielőtt durva fixre horgonyoznánk
const ACC_FLOOR = 6, ACC_TRUST = 1.3;
const STILL_SPEED = 0.5;       // m/s: ennél lassabb Doppler = „áll” bizonyíték
const GO_SPEED = 0.8;          // m/s: gyalogos indulás (lassú séta is)
const FAST_SPEED = 2.5;        // m/s: ennyinél egyetlen fix is elég (jármű indul)
const GO_FIXES = 2;            // az utolsó 3 fixből ennyi gyors kell a feloldáshoz (egyedi sebességtüske nem indít)
const ENTER_MS = 5000, ENTER_FIXES = 4;
const NO_SPEED_ENTER_MS = 20000; // sebességadat nélkül hosszabb ablak kell az „áll” döntéshez
const FAR_M = 30, FAR_AGREE_M = 25;
const FAR_STILL_MS = 45000;    // Doppler-állás mellett ennyi ideig kell tartósan máshol lennie a pozíciónak
const WALK_EXIT_METERS = 8;    // m: sebességadat nélküli kilépés minimális elmozdulása
const NOISE_K = 2.0;
const WALK_MAX_ACC = 25;
const SPEED_NOISE_FLOOR = 1.2;
const SIGMA_A_MIN = 0.8, SIGMA_A_MAX = 4;
const GAP_RESET_MS = 60000;    // mozgásban ennyi csend után a Kalman újraindul

type Vec = { x: number; y: number };
type Axis = { p: number; v: number; Ppp: number; Ppv: number; Pvv: number };
const M_LAT = 110540;

export function createDriftFilter() {
  let lat0 = 0, lng0 = 0, haveOrigin = false;
  const toXY = (lat: number, lng: number): Vec => ({ x: (lng - lng0) * Math.cos((lat0 * Math.PI) / 180) * 111320, y: (lat - lat0) * M_LAT });
  const toLL = (v: Vec): LatLngPoint => ({ lat: lat0 + v.y / M_LAT, lng: lng0 + v.x / (Math.cos((lat0 * Math.PI) / 180) * 111320) });

  let mode: "init" | "moving" | "still" = "init";
  let kx: Axis | null = null, ky: Axis | null = null;
  let lastAt: number | null = null, lastSatAt: number | null = null, initRoughAt: number | null = null;
  let last: FilteredFix | null = null;
  let lastBearing: number | null = null;

  let anchor: Vec = { x: 0, y: 0 }, shown: Vec = { x: 0, y: 0 };
  let rms2 = 36;
  let stillSince: number | null = null;
  let fastHist: boolean[] = [];
  let far: { p: Vec; at: number; dopStill: boolean; afterGap: boolean }[] = [];
  let pendingFar: Vec | null = null;
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
  const emit = (fix: RawFix, pos: LatLngPoint, at: number, extra: Partial<RawFix> = {}): FilteredFix => {
    const m = mode === "still" ? "still" : "moving";
    last = { ...fix, ...pos, ...extra, at, mode: m, stoppedSince: m === "still" ? stillSince : null };
    return last;
  };

  function toMoving(pos: Vec, posVar: number) {
    mode = "moving"; stillSince = null;
    kx = newAxis(pos.x, 0, posVar, 4); ky = newAxis(pos.y, 0, posVar, 4);
    fastHist = []; far = []; pendingFar = null; recent = [];
  }
  function toStill(pos: Vec, spread2: number, since: number) {
    mode = "still"; stillSince = since;
    anchor = { ...pos }; shown = { ...pos };
    rms2 = Math.max(spread2, 9);
    fastHist = []; far = []; pendingFar = null;
  }

  return function filter(fix: RawFix): FilteredFix {
    const at = fix.at ?? Date.now();
    if (lastAt !== null && at <= lastAt && last) return { ...last };   // sorrend-hiba / duplikátum

    // 1) Pontosság-hierarchia (változatlan): friss, jó műholdas fix mellett a durva/hálózati fix eldobódik.
    const satQuality = fix.src !== "network" && fix.acc !== null && fix.acc < SAT_ACC;
    const rough = fix.src === "network" || fix.acc === null || fix.acc > ROUGH_ACC;
    const satFresh = lastSatAt !== null && at - lastSatAt < SAT_FRESH_MS;
    if (rough && satFresh && last) return { ...last, at };
    if (satQuality) lastSatAt = Math.max(lastSatAt ?? at, at);

    if (!haveOrigin) { lat0 = fix.lat; lng0 = fix.lng; haveOrigin = true; }
    const z = toXY(fix.lat, fix.lng);
    const sigma = Math.max(ACC_FLOOR, (fix.acc ?? 15) * ACC_TRUST);
    const w = 1 / (sigma * sigma);
    const dt = lastAt === null ? 1 : Math.min(30, Math.max(0.2, (at - lastAt) / 1000));
    // Doppler-sebesség csak megbízható forrásból: a hálózati/durva fix „0 m/s”-a nem bizonyíték.
    let sp = fix.speed !== null && Number.isFinite(fix.speed) && fix.src !== "network" ? fix.speed : null;
    if (sp !== null && fix.speedAcc != null && fix.speedAcc > 1) sp = null;
    const dopplerOk = sp !== null && (fix.acc === null || fix.acc <= ROUGH_ACC);
    if (fix.bearing != null && Number.isFinite(fix.bearing) && (sp === null || sp > 1)) lastBearing = fix.bearing;
    const prevAt = lastAt;

    // 2) Indítás: durva (hálózati) fixre nem horgonyozunk; megjelenik, de a jó műholdas fixig nincs „állás”.
    if (mode === "init") {
      if (rough && (initRoughAt === null || at - initRoughAt < INIT_ROUGH_MS)) {
        initRoughAt ??= at; lastAt = at;
        return emit(fix, fix, at);
      }
      lastAt = at;
      if (sp === null || sp < STILL_SPEED) {
        toStill(z, 9, at);
        recent = [{ p: z, w, at, speed: sp }];
        return emit(fix, toLL(shown), at, { speed: 0 });
      }
      toMoving(z, sigma * sigma);
      return emit(fix, fix, at);
    }

    /* ---------- ÁLLÁS ---------- */
    if (mode === "still") {
      const d = Math.hypot(z.x - anchor.x, z.y - anchor.y);
      const rms = Math.min(20, Math.sqrt(rms2));
      recent.push({ p: z, w, at, speed: sp });
      if (recent.length > 8) recent.shift();
      const dopStill = dopplerOk && sp! < STILL_SPEED;

      // a) Doppler-indulás: az utolsó 3 fixből 2 gyalogos tempójú; egyetlen tüske nem indít.
      // A járás-jelzés a Doppler hiányában (vagy ha az nem mond ellent) felgyorsítja az indulást; Doppler-„áll” mellett nem számít.
      fastHist.push((dopplerOk && sp! >= GO_SPEED) || (fix.stepping === true && !dopStill));
      if (fastHist.length > 3) fastHist.shift();
      let leave = fastHist.filter(Boolean).length >= GO_FIXES || (dopplerOk && sp! >= FAST_SPEED);
      let relocate: Vec | null = null;

      // b) Távoli klaszter (metró, alagút / multipath-lökés). Egyező távoli fixek kellenek; ha a Doppler végig áll-t mond,
      //    akkor csak tartós (45 s) áthelyeződés számít, a rövid lökés nem.
      const farThr = Math.max(FAR_M, 3 * Math.min(25, Math.max(fix.acc ?? 15, rms)));   // 30…75 m; a durva fix pontatlansága nem „takarja el” a valódi áthelyeződést
      if (!leave) {
        if (d > farThr) {
          if (far.length && Math.hypot(z.x - wmean(far.map((f) => ({ p: f.p, w: 1 }))).x, z.y - wmean(far.map((f) => ({ p: f.p, w: 1 }))).y) > FAR_AGREE_M) far = [];
          far.push({ p: z, at, dopStill, afterGap: prevAt !== null && at - prevAt > 20000 });
          const allStill = far.every((f) => f.dopStill);
          if ((!allStill && far.length >= 3) || (far[0]!.afterGap && far.length >= 2) || (allStill && far.length >= 15 && at - far[0]!.at >= FAR_STILL_MS)) {
            relocate = wmean(far.map((f) => ({ p: f.p, w: 1 })));
            leave = true;
          }
        } else if (d < farThr * 0.6) far = [];
      }

      // c) Sebességadat nélküli (vagy nem egyértelműen álló) elmozdulás: 4 fix átlaga tartósan, növekvően és egy irányban
      //    a tanult zajszint többszörösénél messzebb. A Doppler-„áll” felülírja: a pozíciósodródás nem indulás.
      if (!leave && !dopStill && (fix.acc ?? 999) <= WALK_MAX_ACC && recent.length >= 4) {
        const r4 = recent.slice(-4);
        if (r4[3]!.at - r4[0]!.at <= 8000) {
          const c = wmean(r4);
          const dir = { x: c.x - anchor.x, y: c.y - anchor.y };
          const dl = Math.hypot(dir.x, dir.y);
          const thr = Math.max(WALK_EXIT_METERS, NOISE_K * rms);
          if (dl >= thr) {
            const u = { x: dir.x / dl, y: dir.y / dl };
            const proj = r4.map((r) => (r.p.x - anchor.x) * u.x + (r.p.y - anchor.y) * u.y);
            const lat = r4.map((r) => Math.abs(-(r.p.x - anchor.x) * u.y + (r.p.y - anchor.y) * u.x));
            const lateral = Math.sqrt(lat.reduce((s, l) => s + l * l, 0) / lat.length);
            leave = proj[3]! >= proj[0]! + 1 && proj[3]! >= thr && lateral <= 0.6 * dl;
          if (leave) relocate = c;
          }
        }
      }

      if (!leave) {
        // A horgony szándékosan nem „finomodik”: a korrelált (multipath/légköri) hiba rövid átlagolással nem csökken,
        // a finomítás csak vándoroltatná a jelölőt, és elnyelné a lassú indulást. A zajszint viszont tanulódik.
        const dl = Math.min(d, 1.5 * rms + 3);
        rms2 = 0.95 * rms2 + 0.05 * dl * dl;
        lastAt = at;
        return emit(fix, toLL(shown), at, { speed: 0, bearing: lastBearing });
      }

      // Kilépés
      const wasStillSince = stillSince;
      if (relocate && far.length && far.every((f) => f.dopStill)) {      // tartós áthelyeződés, Doppler szerint végig álló: új horgony
        toStill(relocate, rms2, far[0]!.at);
        lastAt = at;
        return emit(fix, toLL(shown), at, { speed: 0, bearing: lastBearing });
      }
      const v0 = sp !== null && fix.bearing != null && sp >= GO_SPEED
        ? { x: sp * Math.sin((fix.bearing * Math.PI) / 180), y: sp * Math.cos((fix.bearing * Math.PI) / 180) } : { x: 0, y: 0 };
      toMoving(relocate ?? anchor, relocate ? sigma * sigma : Math.max(rms2, 9));
      kx!.v = v0.x; ky!.v = v0.y;
      void wasStillSince;
      // → tovább a MOZGÁS ágon ugyanezzel a fixszel
    }

    /* ---------- MOZGÁS (Kalman, állandó sebesség modell) ---------- */
    if (prevAt !== null && at - prevAt > GAP_RESET_MS) { toMoving(z, sigma * sigma); }
    const kxx = kx!, kyy = ky!;
    const v = Math.hypot(kxx.v, kyy.v);
    const sa = Math.min(SIGMA_A_MAX, Math.max(SIGMA_A_MIN, 0.5 + 0.35 * v));
    predict(kxx, dt, sa); predict(kyy, dt, sa);
    const Rm = sigma * sigma;
    const nis = ((z.x - kxx.p) ** 2) / (kxx.Ppp + Rm) + ((z.y - kyy.p) ** 2) / (kyy.Ppp + Rm);
    const supported = sp !== null && sp >= 2;
    if (nis > 16 && !supported) {
      if (pendingFar && Math.hypot(z.x - pendingFar.x, z.y - pendingFar.y) <= FAR_AGREE_M) {
        const j = { x: (z.x + pendingFar.x) / 2, y: (z.y + pendingFar.y) / 2 };
        kxx.p = j.x; kyy.p = j.y; kxx.v = kyy.v = 0; kxx.Ppp = kyy.Ppp = Rm; kxx.Pvv = kyy.Pvv = 4; kxx.Ppv = kyy.Ppv = 0;
        pendingFar = null; recent = []; lastAt = at;
        return emit(fix, toLL(j), at, { speed: sp ?? 0, bearing: fix.bearing ?? lastBearing });
      }
      pendingFar = z; lastAt = at;
      return emit(fix, toLL({ x: kxx.p, y: kyy.p }), at, { speed: sp ?? Math.hypot(kxx.v, kyy.v), bearing: fix.bearing ?? lastBearing });
    }
    pendingFar = null;
    updPos(kxx, z.x, Rm); updPos(kyy, z.y, Rm);
    if (sp !== null) {
      if (sp >= 0.7 && fix.bearing != null && Number.isFinite(fix.bearing)) {
        const b = (fix.bearing * Math.PI) / 180, R = 0.8 * 0.8 + (0.15 * sp) ** 2;
        updVel(kxx, sp * Math.sin(b), R); updVel(kyy, sp * Math.cos(b), R);
      } else if (sp < STILL_SPEED) {
        updVel(kxx, 0, 0.3 * 0.3); updVel(kyy, 0, 0.3 * 0.3);
      }
    }

    // Belépés az állásba: elég hosszú és elég sűrű „áll” bizonyíték; az állás kezdete = a bizonyíték ablakának eleje.
    recent.push({ p: z, w, at, speed: sp });
    if (recent.length > 24) recent.shift();
    const longWin = recent.some((r) => r.speed === null) ? NO_SPEED_ENTER_MS : ENTER_MS;
    const wnd = recent.filter((r) => at - r.at <= longWin);
    if (wnd.length >= ENTER_FIXES && at - wnd[0]!.at >= longWin * 0.8) {
      const slow = wnd.every((r) => r.speed === null || r.speed <= STILL_SPEED + 0.3);
      const c = wmean(wnd);
      const rms = Math.sqrt(wnd.reduce((s, r) => s + (r.p.x - c.x) ** 2 + (r.p.y - c.y) ** 2, 0) / wnd.length);
      const third = Math.max(1, Math.floor(wnd.length / 3));
      const c1 = wmean(wnd.slice(0, third)), c2 = wmean(wnd.slice(-third));
      const net = Math.hypot(c1.x - c2.x, c1.y - c2.y);   // az ablak eleje és vége közti nettó elmozdulás
      const doppler = wnd.every((r) => r.speed !== null);
      if (slow && rms <= (doppler ? 60 : 45) && (doppler || net <= 6 + 0.5 * rms)) {
        toStill(c, rms * rms, wnd[0]!.at);
        lastAt = at;
        return emit(fix, toLL(shown), at, { speed: 0, bearing: lastBearing });
      }
    }

    lastAt = at;
    const pos = toLL({ x: kxx.p, y: kyy.p });
    const spd = Math.hypot(kxx.v, kyy.v);
    const speedWindow = recent.slice(-4);
    let confirmedMove = false;
    if (speedWindow.length >= 3) {
      const a = speedWindow[0]!.p, b = speedWindow[speedWindow.length - 1]!.p;
      const displacement = Math.hypot(b.x - a.x, b.y - a.y);
      const elapsed = Math.max(0.5, (speedWindow[speedWindow.length - 1]!.at - speedWindow[0]!.at) / 1000);
      confirmedMove = displacement >= Math.max(2.5, elapsed * 0.65);
    }
    const dopplerSpeed = sp !== null && sp >= GO_SPEED && (fix.acc ?? 999) <= WALK_MAX_ACC;
    const displaySpeed = dopplerSpeed ? sp : (confirmedMove && spd >= SPEED_NOISE_FLOOR ? spd : 0);
    const bearing = displaySpeed! >= 0.8 ? ((Math.atan2(kxx.v, kyy.v) * 180) / Math.PI + 360) % 360 : fix.bearing ?? lastBearing;
    return emit(fix, pos, at, { speed: displaySpeed, bearing });
  };
}
