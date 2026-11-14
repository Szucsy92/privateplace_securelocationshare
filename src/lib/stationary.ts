import { distanceMeters, type LatLngPoint } from "./mapMath";

/* ------------------------------------------------------------------ */
/* Megállás-felirat (a MapApp és a PersonBubble ezt a szerződést várja) */
/* ------------------------------------------------------------------ */

export type StopState = { anchor: LatLngPoint; since: number };

/** Ennél gyorsabb haladás biztosan mozgás (m/s). */
export const MOVING_SPEED = 0.55;

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
/* Drift-szűrő: „horgony + bizonyíték” állapotgép                       */
/* ------------------------------------------------------------------ */

/*
 * Alapelv: a pozíció zajos és sodródik, a Doppler-sebesség viszont a pozíciózajtól FÜGGETLEN bizonyíték.
 *  - ÁLLÁS: a kimenet egy pontossággal súlyozott, lassan finomodó horgony. Kilépés csak bizonyítékkal:
 *      a) Doppler ≥ 0,8 m/s (vagy járás-jelzés, ha a Doppler nem mond ellent) az utolsó 3 fixből kettőn; ≥ 2,5 m/s egyen is – az egyedi sebességtüske nem indít;
 *      b) sebességadat nélkül: tartós, egyirányú elmozdulás a tanult zajszint többszöröse fölé;
 *      c) „távoli klaszter”: ha a Doppler végig áll-t mond, a pozíció-ugrás (multipath) csak 45 s tartós elmozdulás után fogadódik el.
 *  - MOZGÁS: állandó sebesség modellű Kalman-szűrő, a HORGONYBÓL indítva (nem a nyers fixből), Doppler-sebességgel javítva.
 *  - A `stoppedSince` ugyanebből az állapotgépből jön, a bizonyíték kezdetére visszadátumozva – nincs külön megállás-detektor.
 *  - INDÍTÁS (`init`): az első fixből nincs azonnali horgony. Több, időben elkülönülő jó fixet gyűjtünk, geometriai mediánnal
 *    kiugrás-mentes klasztert keresünk, és csak stabil klaszterre horgonyozunk. Amíg nincs klaszter, a jelölő a futó mediánt mutatja,
 *    megállás-jelzés (`stoppedSince`) nélkül; ha 20 s alatt sem áll össze, a Kalman-szűrő viszi tovább (nem mutat hamis pontosságot).
 *  - Gyűjtés közben a kimenet `speed` értéke ismeretlen (null): a jelölő a futó mediánt mutatja, de sem „áll”, sem „mozog” felirat nincs.
 *  - MÉRÉSI KÖZ: az ablakok a megfigyelt fix-köz (medián) szerint nyúlnak, így ritkított (3–5 s) mérésnél is felállnak a döntések.
 *  - ÁLLÁS, három koordináta: `anchor` (stabil referencia), `cand` (ellenőrzés alatt álló, tartósan máshol mérő klaszter) és
 *    `shown` (a ténylegesen kirajzolt pont, ami az anchor felé finoman csúszik). A horgony csak hosszú, szűk, a horgonyt nem érintő
 *    klaszterre korrigálódik; a rövid multipath-eltolódást nem követi.
 */
export type RawFix = {
  lat: number; lng: number; acc: number | null; speed: number | null; speedAcc?: number | null; bearing?: number | null; at?: number; src?: "gps" | "network";
  /** Független mozgásjelzés (gyorsulásmérő/lépésérzékelő): igaz, ha az utóbbi ~3 s-ban járás-szerű mozgás volt. */
  stepping?: boolean;
};
export type FilteredFix = RawFix & {
  mode: "still" | "moving"; stoppedSince: number | null;
  /** Hibakereséshez: a szűrő döntésének emberi szavakkal (csak akkor van, ha ennél a fixnél történt valami). */
  note?: string;
  /** Hibakereséshez: álló helyzetben a horgony pontja (különbözhet a kirajzolt ponttól), mozgásban null. */
  anchorLL?: LatLngPoint | null;
  /** Hibakereséshez: igaz, ha a szűrő a pozíciók alapján megcáfolt Dopplert épp figyelmen kívül hagy. */
  distrust?: boolean;
  /** Hibakereséshez: igaz, ha a fixet a pontosság-hierarchia eldobta (a kimenet az előző pont). */
  dropped?: boolean;
};

/* ---- Hangolható állandók ------------------------------------------------------------------------------ */
const SAT_ACC = 20;            // m: ennél pontosabb (és nem hálózati) fix „műholdas minőségű”
const ROUGH_ACC = 30;          // m: ennél pontatlanabb vagy ismeretlen pontosságú fix „durva”
const SAT_FRESH_MS = 22000;    // ennyi ideig friss a műholdas fix; ennyi csend után a durva fix is átjut
const INIT_ROUGH_MS = 8000;    // induláskor ennyit várunk jó fixre, mielőtt durva fixre horgonyoznánk
const ACC_FLOOR = 6, ACC_TRUST = 1.3;
const STILL_SPEED = 0.5;       // m/s: ennél lassabb Doppler = „áll” bizonyíték
const GO_SPEED = 0.55;         // m/s: lassú gyaloglás; pozíciós/lépéses megerősítéssel
const FAST_SPEED = 2.5;        // m/s: ennyinél egyetlen fix is elég (jármű indul)
const STEP_MOVE_MIN_M = 2, STEP_MOVE_ACC_K = 0.4;   // m: köztes Doppler mellett a lépésjelzéshez ennyi nyers elmozdulás kell az utóbbi ~5 fixben
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
const SPARSE_DT = 2.5;         // s: ennél ritkább a mérés → ritkított ablakok
const DT_SAMPLES = 5, DT_MAX_S = 20;   // fix-köz medián: utolsó 5 köz; ennél nagyobb szünet (jelvesztés) nem számít ütemnek
const DOP_CHECK_MIN_MS = 5000; // ennyi pozíció-előzmény kell a Doppler hihetőségi ellenőrzéséhez (mozgás ágon)
const DOP_CHECK_FACTOR = 0.3;  // a Doppler-sebesség szerint várt elmozdulásnak legalább ennyiszerese kell, hogy a pozíciókban is látsszon
const DOP_CHECK_MAX_ACC = 20;  // m: ennél pontatlanabb fixnél nem ítéljük meg a Dopplert
const GO_FIX_ACC = 15;         // m: két független jelzés (Doppler + járás) egyetlen fixből is indít, ha ennyire pontos

// Indítás (horgony felvétele több mérésből)
const ACQ_MAX_ACC = 25;        // m: ennél rosszabb pontosságú fix nem alapozza meg a horgonyt
const ACQ_MIN_FIXES = 5;       // ennyi használható (klaszterbe eső) fix kell
const ACQ_MIN_MS = 12000;      // a mérési ablak minimális hossza
const ACQ_MAX_MS = 20000;      // ennyi idő után (ritka mérésnél a fix-köz többszöröse), ha nincs stabil klaszter, a Kalman-szűrő veszi át
const ACQ_MIN_FIXES_SPARSE = 3; // ritkított (≥ SPARSE_DT s) mérésnél ennyi klaszter-fix is elég
const ACQ_INLIER_MIN_M = 8, ACQ_INLIER_MAX_M = 20, ACQ_INLIER_K = 1.5;   // klaszter-sugár a mediántól
const ACQ_MIN_SHARE = 0.6;     // a fixek legalább ekkora hányadának a klaszterbe kell esnie
const ACQ_MAX_RMS = 12;        // m: a klaszter szórása
const ACQ_STEP_FIXES = 2;      // sebességadat nélküli járás-jelzés: ennyi fix elég az indításkori mozgáshoz

// Álló helyzet: adaptív horgonykorrekció (anchor / cand / shown)
const CAND_MAX_ACC = 20;       // m: csak jó pontosságú fix számít jelöltnek
const CAND_NEAR_M = 7;         // m: ettől (és a fix pontosságától) távolabbi mérés lehet jelölt
const CAND_VISIT_M = 4.5;      // m: ennél közelebb a horgonyhoz mért fix „a horgonynál jártunk” (hiszterézis a kettő közt)
const CAND_AGREE_M = 7;        // m: a jelölt-klaszter tagjai ennyin belül egyeznek
const CAND_MIN_FIXES = 25, CAND_MIN_MS = 120000;  // tartós, egyező mérések a korrekcióhoz (a lassú, hullámzó drift fél-periódusa ennél hosszabb is lehet, ezért 2 perc)
const CAND_MAX_RMS = 4.5;      // m: a jelölt-klaszternek szűknek kell lennie (a vándorló drift nem az)
const CAND_RMS_ACC_K = 0.75;   // a klaszter-szórás határa legalább ennyiszerese a fixek jelentett pontosságának (medián)
const CAND_NEAR_RESET = 3, CAND_NEAR_WIN_MS = 20000;   // ennyi, a horgonynál ebben az időablakban mért fix eldobja a jelöltet (a horgony „él”, a távoli mérés csak epizód); elszórt, véletlen közeli fix nem számít
const CAND_START_FIXES = 8;    // induláskor ennyi egyező jelölt-fixtől indul a mozgás a jelöltből a horgony helyett
const FAST_ACC_MAX = 5;        // m: gyors horgonykorrekció: csak ennél pontosabb fixekből (a drift ±6…50 m pontosságnál jelentkezik)
const FAST_MIN_MS = 12000;     // gyors, de nem azonnali korrekció: legalább 12 s stabil, pontos klaszter
const FAST_MIN_FIXES = 8;      // legalább 8 egyező, pontos fix kell (ritkított mérésnél az időablak is véd)
const FAST_DIST_K = 2;         // a horgonytól mért távolság legalább ennyiszerese a fixek pontosságának
const FAST_NEAR_M = 5.5, FAST_NEAR_K = 2;   // pontos (≤ FAST_ACC_MAX) fixnél már ennyi eltérés is jelölt (a 7 m-es állandó eltolódás is látszik)
const SHOWN_EASE_MIN_M = 1.5;  // m/fix: a megjelenített pont csúszási sebessége az új horgony felé

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
  let far: { p: Vec; at: number; dopStill: boolean; dopplerKnown: boolean; afterGap: boolean }[] = [];
  let pendingFar: { p: Vec; at: number; acc: number | null }[] = [];
  let recent: { p: Vec; w: number; at: number; speed: number | null }[] = [];
  let acq: { p: Vec; w: number; at: number; speed: number | null; acc: number }[] = [];
  let acqStepHits = 0, initAt: number | null = null;
  let cand: { p: Vec; at: number; acc: number }[] = [];
  let candMiss = 0, candNear: number[] = [];
  let dts: number[] = [];
  /** Igaz, ha a Doppler-sebességet a pozíciók megcáfolták (tartós hamis 1–2 m/s): amíg nem igazolódik, nem indít és nem tart mozgásban. */
  let dopDistrust = false;
  let note: string | undefined;
  const f1 = (x: number) => x.toFixed(1).replace(".", ",");
  const say = (t: string) => { note = note ? `${note} · ${t}` : t; };

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
  const geoMedian = (pts: { p: Vec; w: number }[]): Vec => {
    let c = wmean(pts);
    for (let i = 0; i < 25; i++) {
      let sw = 0, sx = 0, sy = 0;
      for (const q of pts) { const k = q.w / Math.max(0.5, Math.hypot(q.p.x - c.x, q.p.y - c.y)); sw += k; sx += q.p.x * k; sy += q.p.y * k; }
      const n = { x: sx / sw, y: sy / sw };
      const moved = Math.hypot(n.x - c.x, n.y - c.y);
      c = n;
      if (moved < 0.01) break;
    }
    return c;
  };
  const rmsAround = (pts: { p: Vec }[], c: Vec) => Math.sqrt(pts.reduce((s, q) => s + (q.p.x - c.x) ** 2 + (q.p.y - c.y) ** 2, 0) / Math.max(1, pts.length));
  /** Indítási klaszter: a medián körüli belső fixek; null, ha nincs elég egyező, időben elnyúló, szűk csoport. */
  const acqCluster = (pts: typeof acq, minFixes: number): { c: Vec; inl: typeof acq; rms: number } | null => {
    if (pts.length < minFixes) return null;
    const c0 = geoMedian(pts);
    const accs = pts.map((q) => q.acc).sort((a, b) => a - b);
    const thr = Math.min(ACQ_INLIER_MAX_M, Math.max(ACQ_INLIER_MIN_M, ACQ_INLIER_K * accs[Math.floor(accs.length / 2)]!));
    const inl = pts.filter((q) => Math.hypot(q.p.x - c0.x, q.p.y - c0.y) <= thr);
    if (inl.length < minFixes || inl.length < ACQ_MIN_SHARE * pts.length) return null;
    if (inl[inl.length - 1]!.at - inl[0]!.at < ACQ_MIN_MS * 0.75) return null;
    const c = wmean(inl);
    const rms = rmsAround(inl, c);
    if (rms > ACQ_MAX_RMS) return null;
    if (inl.some((q) => q.speed === null)) {          // sebességadat nélkül a nettó elmozdulás is számít (lassú séta ne legyen horgony)
      const third = Math.max(1, Math.floor(inl.length / 3));
      const c1 = wmean(inl.slice(0, third)), c2 = wmean(inl.slice(-third));
      if (Math.hypot(c1.x - c2.x, c1.y - c2.y) > 3 + 0.5 * rms) return null;
    }
    return { c, inl, rms };
  };
  const dtEst = () => { if (!dts.length) return 1; const q = [...dts].sort((a, b) => a - b); return q[Math.floor(q.length / 2)]!; };
  /** Zajszint egy ablakból: a medián körüli, kiugrásoktól megtisztított szórás (egyetlen rossz fix ne fújja fel a tanult zajt). */
  const robustSpread = (pts: { p: Vec }[], c: Vec) => {
    const d = pts.map((q) => Math.hypot(q.p.x - c.x, q.p.y - c.y)).sort((a, b) => a - b);
    const lim = Math.max(6, 3 * d[Math.floor(d.length / 2)]!);
    const keep = pts.filter((q) => Math.hypot(q.p.x - c.x, q.p.y - c.y) <= lim);
    return rmsAround(keep, c);
  };
  /** A jelölt-klaszter „lapos”: a három időbeli harmadának közepe nem tér el egymástól (a hullámzó drift csúcsa íves, a valódi eltolódás lapos). */
  const candFlat = (pts: { p: Vec }[], rms: number) => {
    const n = Math.floor(pts.length / 3);
    if (n < 2) return false;
    const c1 = wmean(pts.slice(0, n).map((q) => ({ p: q.p, w: 1 })));
    const c2 = wmean(pts.slice(n, 2 * n).map((q) => ({ p: q.p, w: 1 })));
    const c3 = wmean(pts.slice(-n).map((q) => ({ p: q.p, w: 1 })));
    const tol = 1.5 + (2.5 * Math.max(rms, 1)) / Math.sqrt(n);
    return Math.hypot(c2.x - (c1.x + c3.x) / 2, c2.y - (c1.y + c3.y) / 2) <= tol && Math.hypot(c3.x - c1.x, c3.y - c1.y) <= 2 * tol;
  };
  const resetCand = () => { cand = []; candMiss = 0; candNear = []; };
  const candCenter = () => wmean(cand.map((q) => ({ p: q.p, w: 1 })));
  const emit = (fix: RawFix, pos: LatLngPoint, at: number, extra: Partial<RawFix> = {}): FilteredFix => {
    const m = mode === "still" ? "still" : "moving";
    last = { ...fix, ...pos, ...extra, at, mode: m, stoppedSince: m === "still" ? stillSince : null, note, anchorLL: m === "still" ? toLL(anchor) : null, distrust: dopDistrust };
    note = undefined;
    return last;
  };

  function toMoving(pos: Vec, posVar: number) {
    mode = "moving"; stillSince = null;
    kx = newAxis(pos.x, 0, posVar, 4); ky = newAxis(pos.y, 0, posVar, 4);
    fastHist = []; far = []; pendingFar = []; recent = []; acq = []; acqStepHits = 0; resetCand();
  }
  function toStill(pos: Vec, spread2: number, since: number) {
    mode = "still"; stillSince = since;
    anchor = { ...pos }; shown = { ...pos };
    rms2 = Math.max(spread2, 9);
    fastHist = []; far = []; pendingFar = []; acq = []; acqStepHits = 0; resetCand();
  }

  return function filter(fix: RawFix): FilteredFix {
    const at = fix.at ?? Date.now();
    if (lastAt !== null && at <= lastAt && last) return { ...last };   // sorrend-hiba / duplikátum

    // 1) Pontosság-hierarchia (változatlan): friss, jó műholdas fix mellett a durva/hálózati fix eldobódik.
    const satQuality = fix.src !== "network" && fix.acc !== null && fix.acc < SAT_ACC;
    const rough = fix.src === "network" || fix.acc === null || fix.acc > ROUGH_ACC;
    const satFresh = lastSatAt !== null && at - lastSatAt < SAT_FRESH_MS;
    if (rough && satFresh && last) return { ...last, at, note: undefined, dropped: true };
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
    if (prevAt !== null) { const gap = (at - prevAt) / 1000; if (gap <= DT_MAX_S) { dts.push(Math.max(0.2, gap)); if (dts.length > DT_SAMPLES) dts.shift(); } }
    const dtS = dtEst(), sparse = dtS >= SPARSE_DT;

    // 2) Indítás: durva (hálózati) fixre nem horgonyozunk; megjelenik, de a jó műholdas fixig nincs „állás”.
    if (mode === "init") {
      if (rough && (initRoughAt === null || at - initRoughAt < INIT_ROUGH_MS)) {
        initRoughAt ??= at; lastAt = at;
        return emit(fix, fix, at);
      }
      lastAt = at;
      // Már induláskor mozgó (Doppler) vagy végig csak durva fix: nincs mit horgonyozni, a Kalman viszi; megállást később, bizonyítékkal állít.
      if (rough || (sp !== null && sp >= STILL_SPEED)) { say(rough ? "Indításkor csak durva (hálózati) jel van: nincs horgony, a Kalman-szűrő viszi" : `Indításkor már mozgást mér a Doppler (${f1(sp! * 3.6)} km/h): nincs horgony`); toMoving(z, sigma * sigma); return emit(fix, fix, at); }
      initAt ??= at;
      if (fix.acc !== null && fix.acc <= ACQ_MAX_ACC) {
        acq.push({ p: z, w, at, speed: sp, acc: fix.acc });
        if (acq.length > 40) acq.shift();
        if (sp === null && fix.stepping === true) acqStepHits++;
      }
      const est = acq.length ? geoMedian(acq) : z;
      if (acqStepHits >= ACQ_STEP_FIXES) { say("Indításkor járás-jelzés: mozgásnak veszi"); toMoving(est, sigma * sigma); return emit(fix, toLL(est), at); }
      const cl = acqCluster(acq, sparse ? ACQ_MIN_FIXES_SPARSE : ACQ_MIN_FIXES);
      if (cl && at - acq[0]!.at >= ACQ_MIN_MS) {
        say(`Horgony felvéve indításkor: ${cl.inl.length} egyező fix, szórás ${f1(cl.rms)} m`);
        toStill(cl.c, cl.rms * cl.rms, cl.inl[0]!.at);
        recent = cl.inl.slice(-8).map((q) => ({ p: q.p, w: q.w, at: q.at, speed: q.speed }));
        return emit(fix, toLL(shown), at, { speed: 0 });
      }
      if (at - initAt >= Math.max(ACQ_MAX_MS, 8 * dtS * 1000)) { say("Indításkor sem 20 s alatt nem állt össze stabil klaszter: a Kalman-szűrő viszi tovább"); toMoving(est, sigma * sigma); return emit(fix, toLL(est), at); }
      return emit(fix, toLL(est), at, { speed: null });   // gyűjtés közben: futó medián; a sebesség ismeretlen, így nincs hamis „mozgásban” felirat sem
    }

    /* ---------- ÁLLÁS ---------- */
    if (mode === "still") {
      const d = Math.hypot(z.x - anchor.x, z.y - anchor.y);
      const rms = Math.min(20, Math.sqrt(rms2));
      recent.push({ p: z, w, at, speed: sp });
      if (recent.length > 8) recent.shift();
      const dopStill = dopplerOk && sp! < STILL_SPEED;
      if (dopStill || (dopplerOk && sp! >= FAST_SPEED)) dopDistrust = false;   // hiteles Doppler (valódi 0 vagy jármű-sebesség) visszaadja a bizalmat

      const previous = recent[recent.length - 2];
      const stepDistance = previous ? Math.hypot(z.x - previous.p.x, z.y - previous.p.y) : 0;
      const back = recent[Math.max(0, recent.length - 6)]!;
      // Rövid (1–2 fixből álló) valódi gyalogos elmozdulást is észlelünk, de a helyben
      // ingadozó GPS-zaj nem elég: kell legalább 1,5 m horgonytól való távolság és
      // mérhető fix-közi haladás, vagy hosszabb, összegzett elmozdulás.
      const movedRecently = recent.length >= 2 && (
        (d >= Math.max(1.5, 0.25 * (fix.acc ?? 6)) && stepDistance >= 0.65) ||
        (recent.length >= 4 && Math.hypot(z.x - back.p.x, z.y - back.p.y) >= Math.max(STEP_MOVE_MIN_M, STEP_MOVE_ACC_K * (fix.acc ?? 6)))
      );
      // A Doppler önmagában csak megerősítésre váró jelölt. Két egymást követő
      // mérés kell, és a másodiknál a pozícióváltozásnak is igazolnia kell a mozgást.
      // Így a tartós, helyben jelentkező 1,4 m/s-os hamis sebesség nem indít.
      const dopGo = dopplerOk && sp! >= GO_SPEED && !(dopDistrust && sp! < FAST_SPEED)
        // Az 1,4 m/s körüli, helyben is gyakori hamis Doppler csak pozíciós
        // megerősítéssel számít; a 1,3 m/s-os gyalogos küszöbteszt megmarad.
        && (sp! < 1.4 || movedRecently || fix.stepping === true);
      // Sebességadat nélkül két lépésjelzés elég, ha a második fix már tényleges
      // (legalább ~1 m-es) elmozdulást mutat. Köztes Doppler esetén a helyben
      // topogás továbbra sem számít mozgásnak.
      const stepEv = fix.stepping === true && !dopStill && (!dopplerOk || movedRecently);
      fastHist.push(dopGo || stepEv);
      if (fastHist.length > 3) fastHist.shift();
      // Két független, jó minőségű érzékelő (Doppler + lépés) egyetlen fixből indíthat.
      const bothSensors = dopGo && fix.stepping === true && (fix.acc ?? 999) <= GO_FIX_ACC;
      let leave = (fastHist.filter(Boolean).length >= GO_FIXES && movedRecently)
        || (dopplerOk && sp! >= FAST_SPEED) || bothSensors;
      let relocate: Vec | null = null;
      let why = leave ? (dopplerOk && sp! >= FAST_SPEED ? `gyors Doppler (${f1(sp! * 3.6)} km/h)` : bothSensors ? "Doppler és járás-jelzés együtt" : `Doppler/járás-jelzés az utolsó 3 fixből ${fastHist.filter(Boolean).length}-on`) : "";

      // b) Távoli klaszter (metró, alagút / multipath-lökés). Egyező távoli fixek kellenek; ha a Doppler végig áll-t mond,
      //    akkor csak tartós (45 s) áthelyeződés számít, a rövid lökés nem.
      const farThr = Math.max(FAR_M, 3 * Math.min(25, Math.max(fix.acc ?? 15, rms)));   // 30…75 m; a durva fix pontatlansága nem „takarja el” a valódi áthelyeződést
      if (!leave) {
        if (d > farThr) {
          if (far.length) { const fc = wmean(far.map((f) => ({ p: f.p, w: 1 }))); if (Math.hypot(z.x - fc.x, z.y - fc.y) > FAR_AGREE_M) far = []; }
          far.push({ p: z, at, dopStill, dopplerKnown: dopplerOk, afterGap: prevAt !== null && at - prevAt > 20000 });
          const allStill = far.every((f) => f.dopStill);
          const allNoDoppler = far.every((f) => !f.dopplerKnown);
          const afterGapPair = allNoDoppler && far[0]!.afterGap && far.length >= 2;
          const noSpeedCluster = allNoDoppler && (afterGapPair || far.length >= 3);
          const stillCount = Math.min(15, Math.ceil(FAR_STILL_MS / 1000 / dtS));
          // Doppler-állásnál továbbra is 45 s védelem kell a tartós multipath ellen.
          // Sebességadat hiányában viszont három egyező, jó minőségű távoli fix elég;
          // hosszú GPS-kiesés után két egyező fix is elég a követés helyreállításához.
          if ((allStill && far.length >= stillCount && at - far[0]!.at >= FAR_STILL_MS) || noSpeedCluster) {
            relocate = wmean(far.map((f) => ({ p: f.p, w: 1 })));
            leave = true;
            why = `a pozíció tartósan ${f1(Math.hypot(relocate.x - anchor.x, relocate.y - anchor.y))} m-re van a horgonytól (${far.length} egyező fix)`;
          }
        } else if (d < farThr * 0.6) far = [];
      }

      // c) Sebességadat nélküli (vagy nem egyértelműen álló) elmozdulás: 4 fix átlaga tartósan, növekvően és egy irányban
      //    a tanult zajszint többszörösénél messzebb. A Doppler-„áll” felülírja: a pozíciósodródás nem indulás.
      if (!leave && !dopStill && (fix.acc ?? 999) <= WALK_MAX_ACC && recent.length >= 4) {
        const r4 = recent.slice(-4);
        if (r4[3]!.at - r4[0]!.at <= Math.max(8000, 3.5 * dtS * 1000)) {
          const c = wmean(r4);
          const dir = { x: c.x - anchor.x, y: c.y - anchor.y };
          const dl = Math.hypot(dir.x, dir.y);
          const thr = Math.max(WALK_EXIT_METERS, NOISE_K * rms);
          if (dl >= thr) {
            const u = { x: dir.x / dl, y: dir.y / dl };
            const proj = r4.map((r) => (r.p.x - anchor.x) * u.x + (r.p.y - anchor.y) * u.y);
            const lat = r4.map((r) => Math.abs(-(r.p.x - anchor.x) * u.y + (r.p.y - anchor.y) * u.x));
            const lateral = Math.sqrt(lat.reduce((s, l) => s + l * l, 0) / lat.length);
            // Egyetlen kiugró fix a 4-es átlagot is messzire húzná: legalább 3 fixnek tartósan a küszöb felén túl kell lennie.
            const persistent = [...proj].sort((a, b) => a - b)[1]! >= 0.5 * thr;
            leave = persistent && proj[3]! >= proj[0]! + 1 && proj[3]! >= thr && lateral <= 0.6 * dl;
          if (leave) { relocate = c; why = `tartós, egyirányú elmozdulás ${f1(dl)} m (sebességadat nélkül)`; }
          }
        }
      }

      if (!leave) {
        // Adaptív horgonykorrekció: a horgonytól tartósan máshol, egymással egyező, szűk klaszterben mérő fixek (jelölt).
        // Rövid multipath-eltolódás vagy vándorló drift nem elég; mozgásra utaló jel esetén nem gyűjtünk jelöltet.
        const walkEv = dopGo || stepEv;
        if (fix.src !== "network" && (fix.acc ?? 999) <= CAND_MAX_ACC && !walkEv) {
          const nearThr = (fix.acc ?? 999) <= FAST_ACC_MAX ? Math.max(FAST_NEAR_M, FAST_NEAR_K * (fix.acc ?? 3)) : Math.max(CAND_NEAR_M, fix.acc ?? 10), visitThr = Math.max(CAND_VISIT_M, 0.6 * (fix.acc ?? 10));
          if (d >= nearThr && d < farThr) {
            if (!cand.length) cand.push({ p: z, at, acc: fix.acc ?? 10 });
            else {
              const cc = candCenter();
              if (Math.hypot(z.x - cc.x, z.y - cc.y) <= CAND_AGREE_M) cand.push({ p: z, at, acc: fix.acc ?? 10 });
              else if (++candMiss > 2 + 0.25 * cand.length) { resetCand(); cand.push({ p: z, at, acc: fix.acc ?? 10 }); }
            }
            if (cand.length > 300) cand.shift();
          } else if (d < visitThr && cand.length) {
            // „Látogatás”: a horgonynál több fix is mért egy rövid időn belül (a hullámzó drift átmegy a horgonyon). Ritka mérésnél 2 fix is elég.
            const win = Math.max(CAND_NEAR_WIN_MS, 4 * dtS * 1000);
            candNear = candNear.filter((x) => at - x <= win); candNear.push(at);
            if (candNear.length >= (dtS >= 2 ? 2 : CAND_NEAR_RESET)) resetCand();
          }
          // Gyors ág: pontos, stabil klaszter esetén rövidebb korrekciós ablak, hogy a jelölő ne maradjon
          // 10–15 méterrel a jó nyers GPS mögött. A mozgásjelzés kizárja a jelöltgyűjtést; a klaszter
          // egyezését és laposságát továbbra is ellenőrizzük, ezért egyetlen GPS-tüske nem elég.
          // A korrekció csak akkor érvényes, ha a MOST érkezett fix is a jelölt-klaszter tagja: ha a telefon már visszatért a horgonyhoz,
          // a korábbi (rövid, de elég hosszú ideig gyűjtött) távoli klaszter elavult, és nem szabad rá átugrani.
          const inCluster = cand.length > 0 && cand[cand.length - 1]!.at === at;
          if (cand.length) {
            const good = cand.filter((q) => q.acc <= FAST_ACC_MAX);
            const fastMin = Math.max(5, Math.min(FAST_MIN_FIXES, Math.floor((0.8 * FAST_MIN_MS) / 1000 / dtS)));
            if (inCluster && good.length >= fastMin && at - good[0]!.at >= FAST_MIN_MS && at - good[good.length - 1]!.at <= 5000) {
              const gc = wmean(good.map((q) => ({ p: q.p, w: 1 })));
              const grms = rmsAround(good, gc), gmv = Math.hypot(gc.x - anchor.x, gc.y - anchor.y);
              const gacc = good.map((q) => q.acc).sort((a, b) => a - b)[Math.floor(good.length / 2)]!;
              if (gmv >= Math.max(FAST_NEAR_M, FAST_DIST_K * gacc) && grms <= Math.max(2, CAND_RMS_ACC_K * gacc) && candFlat(good, grms)) {
                say(`Gyors horgonykorrekció ${f1(gmv)} m-rel: ${good.length} pontos fix (±${gacc} m) ${Math.round((at - good[0]!.at) / 1000)} s alatt`);
                anchor = gc; resetCand(); far = [];
              }
            }
          }
          const candMin = Math.max(8, Math.min(CAND_MIN_FIXES, Math.floor((0.8 * CAND_MIN_MS) / 1000 / dtS)));
          if (inCluster && cand.length >= candMin && at - cand[0]!.at >= CAND_MIN_MS) {
            const cc = candCenter();
            const crms = rmsAround(cand, cc), mv = Math.hypot(cc.x - anchor.x, cc.y - anchor.y);
            const accs = cand.map((q) => q.acc).sort((a, b) => a - b);
            const rmsLimit = Math.max(CAND_MAX_RMS, CAND_RMS_ACC_K * accs[Math.floor(accs.length / 2)]!);   // a jelentett pontosság szerinti zajszintnél szűkebb klaszter nem várható
            if (crms <= rmsLimit && candFlat(cand, crms)) { say(`Horgonykorrekció ${f1(mv)} m-rel: ${cand.length} egyező fix ${Math.round((at - cand[0]!.at) / 1000)} s alatt`); anchor = cc; resetCand(); far = []; }   // kontrollált horgonykorrekció; a stillSince marad
          }
        }
        // A `shown` finoman csúszik az anchor felé (nincs ugrás); korrekció nélkül shown === anchor.
        const gap = Math.hypot(anchor.x - shown.x, anchor.y - shown.y);
        if (gap > 0) {
          const step = Math.min(gap, Math.max(SHOWN_EASE_MIN_M, 0.25 * gap));
          shown = step >= gap ? { ...anchor } : { x: shown.x + ((anchor.x - shown.x) * step) / gap, y: shown.y + ((anchor.y - shown.y) * step) / gap };
        }
        // A horgony szándékosan nem „finomodik”: a korrelált (multipath/légköri) hiba rövid átlagolással nem csökken,
        // a finomítás csak vándoroltatná a jelölőt, és elnyelné a lassú indulást. A zajszint viszont tanulódik.
        const dl = Math.min(d, 1.5 * rms + 3);
        rms2 = 0.95 * rms2 + 0.05 * dl * dl;
        lastAt = at;
        return emit(fix, toLL(shown), at, { speed: 0, bearing: lastBearing });
      }

      // Kilépés
      say(`Kilépés az állásból: ${why}`);
      if (relocate && far.length && far.every((f) => f.dopStill || !f.dopplerKnown)) {
        say(`Áthelyeződés ${f1(Math.hypot(relocate.x - anchor.x, relocate.y - anchor.y))} m-rel (a Doppler végig állást mondott)`);      // tartós áthelyeződés, Doppler szerint végig álló: új horgony
        toStill(relocate, rms2, far[0]!.at);
        lastAt = at;
        return emit(fix, toLL(shown), at, { speed: 0, bearing: lastBearing });
      }
      const v0 = sp !== null && fix.bearing != null && sp >= GO_SPEED
        ? { x: sp * Math.sin((fix.bearing * Math.PI) / 180), y: sp * Math.cos((fix.bearing * Math.PI) / 180) } : { x: 0, y: 0 };
      // Induláskor a Kalman a megbízhatóbb pozícióból indul: áthelyeződés > érett jelölt-klaszter > horgony.
      let start: Vec = relocate ?? anchor, startVar = relocate ? sigma * sigma : Math.max(rms2, 9);
      if (!relocate && cand.length >= CAND_START_FIXES && at - cand[cand.length - 1]!.at <= 15000) {
        const cc = candCenter(), cr = rmsAround(cand, cc);
        if (cr <= CAND_MAX_RMS) { start = cc; startVar = Math.max(cr * cr, 9); }
      }
      toMoving(start, startVar);
      kx!.v = v0.x; ky!.v = v0.y;
      // → tovább a MOZGÁS ágon ugyanezzel a fixszel
    }

    /* ---------- MOZGÁS (Kalman, állandó sebesség modell) ---------- */
    if (prevAt !== null && at - prevAt > GAP_RESET_MS) { say("Hosszú jelszünet után a követés újraindult"); toMoving(z, sigma * sigma); }
    // Doppler hihetőségi ellenőrzés: egyes telefonok megállás után is tartósan 1–2 m/s „sebességet” jelentenek (a szolgáltató a
    // pozíciózajból számolja). Ha a Doppler ≥ GO_SPEED, de a pozíciók az elmúlt másodpercekben a várt elmozdulás töredékét sem
    // tették meg, és a lépésérzékelő sem jelez járást, akkor a Doppler-érték nem bizonyíték: 0-nak vesszük, és a megcáfolás
    // addig él (`dopDistrust`), amíg a pozíciók nem igazolják, vagy hiteles Doppler (0 / jármű-sebesség) nem érkezik.
    const distrustBefore = dopDistrust, sp0 = sp;
    if (sp !== null && sp < STILL_SPEED) dopDistrust = false;
    else if (sp !== null && sp >= FAST_SPEED) dopDistrust = false;
    else if (sp !== null && fix.stepping !== true && (fix.acc ?? 999) <= DOP_CHECK_MAX_ACC) {
      const span = Math.max(8000, 3 * dtS * 1000);
      const pts = [...recent.filter((r) => at - r.at <= span), { p: z, at }];
      let verdict: "bad" | "ok" | "unknown" = "unknown";
      if (pts.length >= 5 && at - pts[0]!.at >= DOP_CHECK_MIN_MS) {
        const n = Math.max(1, Math.floor(pts.length / 3));
        const head = pts.slice(0, n), tail = pts.slice(-n);
        const c1 = wmean(head.map((q) => ({ p: q.p, w: 1 }))), c2 = wmean(tail.map((q) => ({ p: q.p, w: 1 })));
        const el = (tail.reduce((q, r) => q + r.at, 0) / n - head.reduce((q, r) => q + r.at, 0) / n) / 1000;
        if (el >= 3) {
          // A küszöb zajérzékeny: a pozíciók szórásánál (kiugrásoktól megtisztítva) kisebb elmozdulás nem bizonyít mozgást.
          const margin = Math.max(2, DOP_CHECK_FACTOR * sp * el, 1.2 * robustSpread(pts, geoMedian(pts.map((q) => ({ p: q.p, w: 1 })))));
          const disp = Math.hypot(c2.x - c1.x, c2.y - c1.y);
          verdict = disp < margin ? "bad" : disp >= 1.5 * margin ? "ok" : "unknown";   // köztes sáv: marad az eddigi döntés (nincs villogás)
        }
      }
      if (verdict === "bad") dopDistrust = true;
      else if (verdict === "ok") dopDistrust = false;
      if (sp >= GO_SPEED && dopDistrust) sp = 0;
    }
    if (!distrustBefore && dopDistrust) say(`A Doppler ${f1(sp0! * 3.6)} km/h-t mond, de a pozíciók nem mozdulnak: nem vesszük figyelembe`);
    else if (distrustBefore && !dopDistrust) say("A Doppler újra hiteles");
    const kxx = kx!, kyy = ky!;
    const v = Math.hypot(kxx.v, kyy.v);
    const sa = Math.min(SIGMA_A_MAX, Math.max(SIGMA_A_MIN, 0.5 + 0.35 * v));
    predict(kxx, dt, sa); predict(kyy, dt, sa);
    const Rm = sigma * sigma;
    const nis = ((z.x - kxx.p) ** 2) / (kxx.Ppp + Rm) + ((z.y - kyy.p) ** 2) / (kyy.Ppp + Rm);
    const supported = sp !== null && sp >= 2;
    if (nis > 16 && !supported) {
      // Egyetlen / két egyező távoli GPS-fix még nem bizonyít áthelyeződést:
      // a multipath gyakran több másodpercig ugyanazon hamis koordinátát adja.
      // Három egyező, jó minőségű fix és legalább 5 s tartó klaszter szükséges.
      const pendingLast = pendingFar[pendingFar.length - 1];
      if (pendingLast && Math.hypot(z.x - pendingLast.p.x, z.y - pendingLast.p.y) <= FAR_AGREE_M) {
        pendingFar.push({ p: z, at, acc: fix.acc });
      } else {
        pendingFar = [{ p: z, at, acc: fix.acc }];
      }
      const pendingGood = pendingFar.filter((q) => q.acc !== null && q.acc <= 25);
      if (pendingGood.length >= 3 && pendingGood[pendingGood.length - 1]!.at - pendingGood[0]!.at >= 5000) {
        const j = wmean(pendingGood.map((q) => ({ p: q.p, w: 1 })));
        kxx.p = j.x; kyy.p = j.y; kxx.v = kyy.v = 0; kxx.Ppp = kyy.Ppp = Rm; kxx.Pvv = kyy.Pvv = 4; kxx.Ppv = kyy.Ppv = 0;
        say(`Pozícióugrás elfogadva (${pendingGood.length} egyező fix, ${Math.round((pendingGood[pendingGood.length - 1]!.at - pendingGood[0]!.at) / 1000)} s)`);
        pendingFar = []; recent = []; lastAt = at;
        return emit(fix, toLL(j), at, { speed: sp ?? 0, bearing: fix.bearing ?? lastBearing });
      }
      say("Kiugró fix visszatartva (tartós klaszter megerősítésére vár)");
      lastAt = at;
      return emit(fix, toLL({ x: kxx.p, y: kyy.p }), at, { speed: sp ?? Math.hypot(kxx.v, kyy.v), bearing: fix.bearing ?? lastBearing });
    }
    pendingFar = [];
    updPos(kxx, z.x, Rm); updPos(kyy, z.y, Rm);
    if (sp !== null) {
      if (sp >= 0.7 && fix.bearing != null && Number.isFinite(fix.bearing)) {
        const b = (fix.bearing * Math.PI) / 180, R = 0.8 * 0.8 + (0.15 * sp) ** 2;
        updVel(kxx, sp * Math.sin(b), R); updVel(kyy, sp * Math.cos(b), R);
      } else if (sp < GO_SPEED) {
        // Lassú / álló Doppler: a Kalman-sebesség gyorsan nullára húzódik (az előző nagy sebesség ne „csengjen utána”).
        const R = sp < STILL_SPEED ? 0.3 * 0.3 : 0.5 * 0.5;
        updVel(kxx, 0, R); updVel(kyy, 0, R);
      } else {
        // Irány nélküli Doppler: a sebesség nagyságát igazítjuk a mérthez (az irányt a Kalman tartja).
        const cur = Math.hypot(kxx.v, kyy.v);
        if (cur > 0.1) { const k = Math.min(1, sp / cur); kxx.v *= k; kyy.v *= k; }
      }
    }

    // Belépés az állásba: elég hosszú és elég sűrű „áll” bizonyíték; az állás kezdete = a bizonyíték ablakának eleje.
    recent.push({ p: z, w, at, speed: sp });
    if (recent.length > 24) recent.shift();
    const longWin = Math.max(recent.some((r) => r.speed === null) ? NO_SPEED_ENTER_MS : ENTER_MS, 4 * dtS * 1000);
    const wnd = recent.filter((r) => at - r.at <= longWin);
    if (wnd.length >= ENTER_FIXES && at - wnd[0]!.at >= longWin * 0.8) {
      const slow = wnd.every((r) => r.speed === null || r.speed <= STILL_SPEED + 0.3);
      const c = geoMedian(wnd);
      const rms = robustSpread(wnd, c);
      const third = Math.max(1, Math.floor(wnd.length / 3));
      const c1 = wmean(wnd.slice(0, third)), c2 = wmean(wnd.slice(-third));
      const net = Math.hypot(c1.x - c2.x, c1.y - c2.y);   // az ablak eleje és vége közti nettó elmozdulás
      const doppler = wnd.every((r) => r.speed !== null);
      if (slow && rms <= (doppler ? 60 : 45) && (doppler || net <= 6 + 0.5 * rms)) {
        say(`Állásba lépett: ${wnd.length} fix, szórás ${f1(rms)} m, ${doppler ? "Doppler-állás" : "sebességadat nélkül"}; horgony a nyers pontok mediánjára`);
        toStill(c, rms * rms, wnd[0]!.at);
        lastAt = at;
        return emit(fix, toLL(shown), at, { speed: 0, bearing: lastBearing });
      }
    }

    lastAt = at;
    const pos = toLL({ x: kxx.p, y: kyy.p });
    const spd = Math.hypot(kxx.v, kyy.v);
    // A Doppler-sebesség független a pozíciózajtól, ezért ha van, az a döntő: a Kalman-maradék és a pozíció-ugrálás
    // nem jeleníthet meg „mozgást”, amikor a Doppler áll (pl. 23 km/h-s menetből megállva nem maradhat 5 km/h).
    // Doppler nélkül a sebesség a pozíciók két felének súlypontja közti, zajszinttel korrigált elmozdulásból jön,
    // és soha nem lehet nagyobb a Kalman-becslésnél.
    let displaySpeed: number;
    if (dopplerOk && sp !== null && (fix.acc ?? 999) <= WALK_MAX_ACC) {
      displaySpeed = sp >= STILL_SPEED ? sp : 0;
    } else {
      const win = recent.slice(-6);
      let est = 0;
      if (win.length >= 4) {
        const half = Math.floor(win.length / 2);
        const a = win.slice(0, half), b = win.slice(-half);
        const ca = wmean(a), cb = wmean(b);
        const ta = a.reduce((q, r) => q + r.at, 0) / a.length, tb = b.reduce((q, r) => q + r.at, 0) / b.length;
        const disp = Math.hypot(cb.x - ca.x, cb.y - ca.y);
        const el = Math.max(0.5, (tb - ta) / 1000);
        const margin = Math.max(2.5, 0.6 * (fix.acc ?? 15));
        if (disp >= margin && disp / el >= SPEED_NOISE_FLOOR) est = Math.min(spd, disp / el);
      }
      displaySpeed = est >= SPEED_NOISE_FLOOR ? est : 0;
    }
    const bearing = displaySpeed >= 0.8 ? ((Math.atan2(kxx.v, kyy.v) * 180) / Math.PI + 360) % 360 : fix.bearing ?? lastBearing;
    return emit(fix, pos, at, { speed: displaySpeed, bearing });
  };
}
