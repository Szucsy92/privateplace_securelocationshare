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
export type RawFix = { lat: number; lng: number; acc: number | null; speed: number | null; bearing?: number | null; at?: number; src?: "gps" | "network" };

/* ---- Hangolható állandók ------------------------------------------------------------------------------ */
// Pontosság-hierarchia: friss, jó műholdas fix mellett a durva/hálózati fix nem juthat át.
const SAT_ACC = 20;            // m: ennél pontosabb (és nem hálózati) fix „műholdas minőségű”
const ROUGH_ACC = 30;          // m: ennél pontatlanabb vagy ismeretlen pontosságú fix „durva”
const SAT_FRESH_MS = 22000;    // ennyi ideig friss a műholdas fix; ennyi csend után (türelmi idő) a durva fix is átjut
const ACC_FLOOR = 6;           // m: a jelentett pontosságot ennél jobbnak nem hisszük el
const ACC_TRUST = 1.3;         // a jelentett pontosság szorzója (a telefon többnyire túl optimista)
const STILL_SPEED = 0.5;       // m/s: ennél lassabb Doppler-sebesség „áll” bizonyíték
const START_STILL_SPEED = 0.5; // m/s: ennél lassabb első fixnél azonnal álló módban indulunk
const GO_SPEED = 1.1;          // m/s: gyalogos tempó; ennél gyorsabb Doppler-sebességnél azonnal feloldunk
const GO_FIXES = 1;            // ennyi egymást követő gyors fix kell a feloldáshoz (2-re emelve robusztusabb, de 1 mp-et késik)
const ENTER_MS = 5000;         // ennyi ideig kell „állónak” látszania a belépéshez
const ENTER_FIXES = 4;         // és legalább ennyi fixből
const SHELL_M = 4.5;           // m: álló helyzetben ekkora védőzónán belüli zaj teljesen elnyelődik
const FAR_M = 40;              // m: ennél távolabbi fix „nagy ugrás” jelölt
const FAR_AGREE_M = 25;        // m: két távoli fix ennyin belül megegyezik -> valódi áthelyeződés
const ANCHOR_WEIGHT_CAP = 0.8;
const WALK_EXIT_METERS = 3.5;   // m: tartós pozícióeltérés lassú gyaloglásnál (nyugodt GPS-nél)
const NOISE_K = 2.2;            // a vektor-küszöb a tanult zaj (RMS) ennyiszerese, ha az nagyobb a 3,5 m-nél
const SPEED_NOISE_FLOOR = 1.2; // m/s: ennél kisebb becsült sebességet GPS-zajnak tekintünk
const WALK_MAX_ACC = 20;        // m: rossz pontosságú fixből ne következtessünk gyaloglásra
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
  let lastSatAt: number | null = null;
  let lastBearing: number | null = null;

  // „állás” állapot
  let anchor: Vec = { x: 0, y: 0 }, anchorW = 0, shown: Vec = { x: 0, y: 0 };
  let rms2 = 100;                // a horgonytól mért távolságnégyzet mozgóátlaga (m²)
  let outside = 0, fastCount = 0;
  let farPrev: Vec | null = null;     // állásban: az előző távoli fix
  let pendingFar: Vec | null = null;  // mozgásban: az elutasított, távoli fix
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
    outside = 0; fastCount = 0; farPrev = null; pendingFar = null; recent = [];
    lastAt = at;
  }
  function toStill(pos: Vec, spread2: number) {
    mode = "still";
    anchor = { ...pos }; shown = { ...pos }; anchorW = ANCHOR_WEIGHT_CAP / 2;
    rms2 = Math.max(spread2, 9);
    outside = 0; fastCount = 0; farPrev = null; pendingFar = null;
  }

  /** Kiszűrt fixnél (pontatlan/hálózati becslés friss, jó műholdas fix mellett) az utolsó kimenetet adja vissza változatlan helyzettel. */
  return function filter(fix: RawFix): RawFix {
    const at = fix.at ?? Date.now();

    // 1) Pontosság-hierarchia. Friss, jó (<20 m) műholdas fix mellett a durva (>30 m / ismeretlen) vagy hálózati
    //    fix csendben eldobódik. Ha a műholdjel tartósan (SAT_FRESH_MS) megszűnt, a durva fix átjut: nem maradunk hely nélkül.
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
    const sp = fix.speed;
    if (fix.bearing != null && Number.isFinite(fix.bearing) && (sp === null || sp > 1)) lastBearing = fix.bearing;

    // 2) Csendes indítás: ha az első fix álló helyzetet jelez (vagy nincs sebességadat, és a gyors
    //    elmozdulás-felismerés úgyis feloldja), a jelölő azonnal rögzül, nincs kezdeti „vándorlás”.
    if (mode === "init") {
      lastAt = at;
      if (sp === null || sp < START_STILL_SPEED) {
        toStill(z, 9);
        recent = [{ p: z, w, at, speed: sp }];
        last = { ...fix, speed: 0, at };
        return last;
      }
      toMoving(z, at);
      last = { ...fix, at };
      return last;
    }

    /* ---------- ÁLLÁS ---------- */
    if (mode === "still") {
      const d = Math.hypot(z.x - anchor.x, z.y - anchor.y);
      recent.push({ p: z, w, at, speed: sp });
      if (recent.length > 4) recent.shift();

      // a) Gyalogos Doppler-sebesség: az első ≥1,1 m/s-os fix azonnal feloldja az állást.
      const dopplerOk = sp !== null && (fix.acc === null || fix.acc <= ROUGH_ACC);
      fastCount = dopplerOk && sp >= GO_SPEED ? fastCount + 1 : 0;
      let leave = fastCount >= GO_FIXES;
      let snap: Vec | null = null;

      // b) Nagy ugrás (metró, villamos indul): 2 egymást követő, egymással egyező távoli fix után azonnal átugrunk.
      if (!leave) {
        if (d > FAR_M) {
          if (farPrev && Math.hypot(z.x - farPrev.x, z.y - farPrev.y) <= FAR_AGREE_M) {
            leave = true;
            snap = { x: (z.x + farPrev.x) / 2, y: (z.y + farPrev.y) / 2 };
          } else farPrev = z;
        } else farPrev = null;
      }

      // c) Vektorszűrés (nincs megbízható sebesség): 3 egymást követő fix tartósan ugyanabba az irányba távolodik a
      //    kiindulási ponttól, az utolsó legalább 3,5 m-re. A körkörös, véletlen zaj ezt nem teljesíti.
      if (!leave && (sp === null || sp < GO_SPEED) && (fix.acc ?? 999) <= WALK_MAX_ACC && recent.length >= 3) {
        const r3 = recent.slice(-3);
        const c = wmean(r3);
        const dir = { x: c.x - anchor.x, y: c.y - anchor.y };
        const dl = Math.hypot(dir.x, dir.y);
        if (dl > 1e-6) {
          const u = { x: dir.x / dl, y: dir.y / dl };
          const proj = r3.map((r) => (r.p.x - anchor.x) * u.x + (r.p.y - anchor.y) * u.y);
          const lat = r3.map((r) => Math.abs(-(r.p.x - anchor.x) * u.y + (r.p.y - anchor.y) * u.x));
          const growing = proj[1] >= proj[0] - 0.5 && proj[2] >= proj[1] - 0.5;
          // A küszöb nyugodt GPS-nél 3,5 m; hullámzó GPS-nél a tanult zajszinttel nő (különben a zaj indulásnak látszana).
          // Ha a telefon ad sebességet, az már „áll” bizonyíték: a Doppler a gyors kilépést kezeli, itt szigorúbbak vagyunk.
          const thr = Math.max(WALK_EXIT_METERS, NOISE_K * Math.sqrt(rms2)) * (sp !== null ? 2 : 1);
          const forward = proj[0] >= thr * 0.3 && proj[2] >= thr;
          const straight = lat.every((l, i) => l <= proj[i]);
          leave = growing && forward && straight;
        }
      }

      if (leave) {
        const c = wmean(recent.slice(-3));
        const start = snap ?? (fastCount >= GO_FIXES ? z : c);
        toMoving(start, at);
        if (sp !== null && fix.bearing != null && sp >= GO_SPEED) {
          const b = (fix.bearing * Math.PI) / 180;
          kx!.v = sp * Math.sin(b); ky!.v = sp * Math.cos(b);
        }
        lastAt = at;
        const pos = toLL({ x: kx!.p, y: ky!.p });
        last = { ...fix, ...pos, at };
        return last;
      }

      // A ténylegesen mért állóhelyzeti zajt tanulja; egy-egy kiugró vagy induló séta hatását korlátozza (winsorizálás).
      const dl = Math.min(d, 1.5 * Math.sqrt(rms2) + 3);
      rms2 = 0.95 * rms2 + 0.05 * dl * dl;
      // Álló helyzetben a védőzónán (SHELL_M) belüli minden zaj elnyelődik: a jelölő mozdulatlan.
      // A zónán kívüli, de még nem tartós eltérés (kiugró pont, oda-vissza zaj) sem mozdítja.
      lastAt = at;
      last = { ...fix, ...toLL(shown), speed: 0, bearing: lastBearing, at };
      return last;
    }

    /* ---------- MOZGÁS (Kalman, állandó sebesség modell) ---------- */
    const kxx = kx!, kyy = ky!;
    const v = Math.hypot(kxx.v, kyy.v);
    const sa = Math.min(SIGMA_A_MAX, Math.max(SIGMA_A_MIN, 0.5 + 0.35 * v));
    predict(kxx, dt, sa); predict(kyy, dt, sa);
    // Kiugró fix kapuzása: a jósolt helytől 4σ-nál messzebbi fixet az első alkalommal nem vesszük be; ha a következő is
    // ugyanoda mutat (2 távoli fix), valódi áthelyeződés: azonnal átugrunk. A gyors Doppler-sebesség igazolja a mozgást.
    const Rm = sigma * sigma;
    const nis = ((z.x - kxx.p) ** 2) / (kxx.Ppp + Rm) + ((z.y - kyy.p) ** 2) / (kyy.Ppp + Rm);
    const supported = sp !== null && sp >= 2;
    if (nis > 16 && !supported) {
      if (pendingFar && Math.hypot(z.x - pendingFar.x, z.y - pendingFar.y) <= FAR_AGREE_M) {
        const j = { x: (z.x + pendingFar.x) / 2, y: (z.y + pendingFar.y) / 2 };
        kxx.p = j.x; kyy.p = j.y; kxx.v = kyy.v = 0; kxx.Ppp = kyy.Ppp = Rm; kxx.Pvv = kyy.Pvv = 4; kxx.Ppv = kyy.Ppv = 0;
        pendingFar = null;
        recent = [];
        lastAt = at;
        last = { ...fix, ...toLL(j), speed: sp ?? 0, bearing: fix.bearing ?? lastBearing, at };
        return last;
      }
      pendingFar = z;
      lastAt = at;
      last = { ...fix, ...toLL({ x: kxx.p, y: kyy.p }), speed: sp ?? Math.hypot(kxx.v, kyy.v), bearing: fix.bearing ?? lastBearing, at };
      return last;
    }
    pendingFar = null;
    updPos(kxx, z.x, Rm); updPos(kyy, z.y, Rm);
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
    // A Kalman velocity can become nonzero from GPS jitter alone. Confirm it
    // against displacement across recent fixes before exposing it as speed.
    const speedWindow = recent.slice(-4);
    let confirmedMove = false;
    if (speedWindow.length >= 3) {
      const a = speedWindow[0].p, b = speedWindow[speedWindow.length - 1].p;
      const displacement = Math.hypot(b.x - a.x, b.y - a.y);
      const elapsed = Math.max(0.5, (speedWindow[speedWindow.length - 1].at - speedWindow[0].at) / 1000);
      confirmedMove = displacement >= Math.max(2.5, elapsed * 0.65);
    }
    const dopplerSpeed = sp !== null && sp >= GO_SPEED && (fix.acc ?? 999) <= WALK_MAX_ACC;
    const displaySpeed = dopplerSpeed ? sp : (confirmedMove && spd >= SPEED_NOISE_FLOOR ? spd : 0);
    const bearing = displaySpeed >= 0.8 ? ((Math.atan2(kxx.v, kyy.v) * 180) / Math.PI + 360) % 360 : fix.bearing ?? lastBearing;
    last = { ...fix, ...pos, speed: displaySpeed, bearing, at };
    return last;
  };
}
