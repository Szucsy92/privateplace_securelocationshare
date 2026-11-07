import type { LatLngPoint } from "./mapMath";
import type { FilteredFix, RawFix } from "./stationary";

/* ------------------------------------------------------------------ */
/* Hibakereső napló: a nyers GPS és a szűrt jelölő összevetése         */
/* ------------------------------------------------------------------ */

/*
 * A napló csak a telefon memóriájában él (kb. az utolsó 40 perc), és csak akkor hagyja el a készüléket, ha te elküldöd.
 * A kiküldött napló NEM tartalmaz koordinátát: minden pont a napló készítésekor mutatott jelölőhöz képest van méterben.
 */

export type DebugEntry = {
  at: number;
  raw: { lat: number; lng: number; acc: number | null; speed: number | null; bearing: number | null; src: string; stepping: boolean | null };
  out: { lat: number; lng: number; speed: number | null; mode: "still" | "moving"; stoppedSince: number | null };
  anchor: LatLngPoint | null;
  note: string | undefined;
  dropped: boolean;
  distrust: boolean;
};

export type DebugRecorder = {
  push(raw: RawFix, out: FilteredFix): void;
  entries(): DebugEntry[];
  last(): DebugEntry | undefined;
  clear(): void;
};

export function createDebugRecorder(max = 2400): DebugRecorder {
  let list: DebugEntry[] = [];
  return {
    push(raw, out) {
      list.push({
        at: raw.at ?? out.at ?? Date.now(),
        raw: { lat: raw.lat, lng: raw.lng, acc: raw.acc, speed: raw.speed, bearing: raw.bearing ?? null, src: raw.src ?? "gps", stepping: raw.stepping ?? null },
        out: { lat: out.lat, lng: out.lng, speed: out.speed, mode: out.mode, stoppedSince: out.stoppedSince },
        anchor: out.anchorLL ? { lat: out.anchorLL.lat, lng: out.anchorLL.lng } : null,
        note: out.note,
        dropped: out.dropped === true,
        distrust: out.distrust === true,
      });
      if (list.length > max) list = list.slice(-max);
    },
    entries: () => list,
    last: () => list[list.length - 1],
    clear() { list = []; },
  };
}

/* ---- geometria ------------------------------------------------------------------------------------- */

type XY = { x: number; y: number };   // x = kelet (m), y = észak (m)
const toLocal = (ref: LatLngPoint, p: LatLngPoint): XY => ({
  x: (p.lng - ref.lng) * Math.cos((ref.lat * Math.PI) / 180) * 111320,
  y: (p.lat - ref.lat) * 110574,
});
const WINDS = ["É", "ÉK", "K", "DK", "D", "DNy", "Ny", "ÉNy"];
/** Égtáj (nyolcas felosztás) az `a` pontból a `b` felé. */
export function compass(a: LatLngPoint, b: LatLngPoint): string {
  const v = toLocal(a, b);
  const deg = ((Math.atan2(v.x, v.y) * 180) / Math.PI + 360) % 360;
  return WINDS[Math.round(deg / 45) % 8]!;
}
export function metersBetween(a: LatLngPoint, b: LatLngPoint): number {
  const v = toLocal(a, b);
  return Math.hypot(v.x, v.y);
}
const fmt = (x: number, d = 1) => x.toFixed(d).replace(".", ",");
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
const pct = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]!; };
const clock = (t: number) => new Date(t).toLocaleTimeString("hu-HU", { hour12: false });
const kmhText = (v: number | null) => (v == null ? "–" : fmt(v * 3.6, 0));

/** Szabályos sokszög egy kör közelítésére (térképi pontossági kör). */
export function circlePolygon(center: LatLngPoint, radiusM: number, n = 48): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radiusM / 110574, dLng = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; out.push([center.lng + dLng * Math.cos(a), center.lat + dLat * Math.sin(a)]); }
  return out;
}

/* ---- élő réteg a térképen -------------------------------------------------------------------------- */

export type DebugOverlay = {
  raw: LatLngPoint; acc: number | null; shown: LatLngPoint; anchor: LatLngPoint | null;
  trail: LatLngPoint[];
  /** Pl. „9 m ÉK” – a nyers pont a jelölőtől. */
  offsetLabel: string;
  offsetM: number;
};

export function overlayFrom(entries: DebugEntry[]): DebugOverlay | null {
  const last = entries[entries.length - 1];
  if (!last) return null;
  const shown = { lat: last.out.lat, lng: last.out.lng };
  const raw = { lat: last.raw.lat, lng: last.raw.lng };
  const m = metersBetween(shown, raw);
  return {
    raw, acc: last.raw.acc, shown, anchor: last.anchor,
    trail: entries.slice(-60, -1).map((e) => ({ lat: e.raw.lat, lng: e.raw.lng })),
    offsetM: m,
    offsetLabel: m < 1 ? "egyezik" : `${fmt(m, m < 10 ? 1 : 0)} m ${compass(shown, raw)}`,
  };
}

/* ---- jelentés -------------------------------------------------------------------------------------- */

export type ScreenContext = {
  /** A buborék felirata (pl. „14 perce”), ha ismert. */
  stopText: string;
  speedText: string;
  gpsStatus: string;
  sharing: boolean;
  following: boolean;
  orientation: string;
  trails: boolean;
  debugLayer: boolean;
  theme: string;
  visible: boolean;
  version: string;
  userAgent: string;
};

type Diag = { level: "info" | "warn"; text: string };

function diagnose(es: DebugEntry[]): Diag[] {
  const out: Diag[] = [];
  const last = es[es.length - 1];
  if (!last) return out;
  const recent = es.filter((e) => last.at - e.at <= 120000 && !e.dropped);
  const accs = recent.map((e) => e.raw.acc).filter((x): x is number => x != null);
  const accMed = median(accs);
  const shown = { lat: last.out.lat, lng: last.out.lng };
  const centroid = recent.length ? { lat: recent.reduce((s, e) => s + e.raw.lat, 0) / recent.length, lng: recent.reduce((s, e) => s + e.raw.lng, 0) / recent.length } : null;
  if (centroid) {
    const d = metersBetween(shown, centroid);
    const dir = compass(shown, centroid);
    if (last.out.mode === "still" && d > Math.max(8, accMed)) out.push({ level: "warn", text: `A jelölő a vártnál messzebb áll a nyers GPS elmúlt 2 perces átlagától (${fmt(d, 0)} m, ${dir} felé; a telefon pontossága kb. ±${fmt(accMed, 0)} m). Ilyenkor a szűrő horgonya eltér a mérésektől.` });
    else if (d <= Math.max(4, accMed / 2) && accMed >= 15) out.push({ level: "info", text: `A jelölő a nyers GPS átlagán áll, de a GPS pontossága gyenge (±${fmt(accMed, 0)} m). Ha a jelölő mégis rossz helyen van, a GPS maga mér félre (beltér, takarás); ezt a szűrő nem tudja kijavítani.` });
  }
  const net = recent.filter((e) => e.raw.src === "network").length;
  if (recent.length && net / recent.length > 0.3) out.push({ level: "warn", text: `Az elmúlt 2 percben a fixek ${fmt((100 * net) / recent.length, 0)}%-a hálózati (Wi-Fi/cella) alapú volt, nem műholdas.` });
  if (accMed > 25) out.push({ level: "warn", text: `A jelentett pontosság medián ±${fmt(accMed, 0)} m: a telefon maga sem tudja pontosan, hol van.` });
  const jumps = es.filter((e) => e.note && /ugrás elfogadva|Áthelyeződés/.test(e.note)).length;
  if (jumps) out.push({ level: "info", text: `${jumps} alkalommal elfogadott egy nagyobb pozícióugrást vagy áthelyeződést a szűrő.` });
  const corr = es.filter((e) => e.note?.includes("Horgonykorrekció"));
  if (corr.length) out.push({ level: "info", text: `${corr.length} horgonykorrekció történt (a jelölő ilyenkor finoman áthúzódik az új helyre).` });
  const distrust = es.filter((e) => e.note?.includes("nem vesszük figyelembe")).length;
  if (distrust) out.push({ level: "info", text: `${distrust} alkalommal hamisnak minősítette a szűrő a Doppler-sebességet (a telefon sebességet mondott, de a pozíciók nem mozdultak).` });
  if (!out.length) out.push({ level: "info", text: "Nincs feltűnő jel: a jelölő összhangban van a nyers GPS-szel." });
  return out;
}

export function buildReport(es: DebugEntry[], ctx: ScreenContext, now = Date.now()): string {
  const L: string[] = [];
  const last = es[es.length - 1];
  L.push("PRIVATE PLACE – HELYMEGHATÁROZÁSI NAPLÓ");
  L.push(`Készült: ${new Date(now).toLocaleString("hu-HU", { hour12: false })}  ·  Verzió: ${ctx.version}`);
  L.push(`Eszköz: ${ctx.userAgent.slice(0, 120)}`);
  L.push("Koordináta nincs a naplóban: minden pont a napló készítésekor mutatott jelölőhöz képest van, méterben (K = kelet, É = észak).");
  L.push("");
  if (!last) { L.push("Még nincs rögzített GPS-adat."); return L.join("\n"); }
  const shown = { lat: last.out.lat, lng: last.out.lng };
  const rawNow = { lat: last.raw.lat, lng: last.raw.lng };
  const dRaw = metersBetween(shown, rawNow);

  L.push("1) MIT LÁTTÁL A KÉPERNYŐN");
  L.push(`• Jelölő felirata: „${ctx.stopText || "–"}”, sebesség: ${ctx.speedText || "–"}`);
  L.push(`• Szűrő állapota: ${last.out.mode === "still" ? "ÁLL" : "MOZGÁSBAN"}${last.distrust ? " (a Dopplert épp megcáfoltnak tekinti)" : ""}`);
  L.push(`• Nyers GPS a jelölőtől: ${dRaw < 1 ? "egyezik" : `${fmt(dRaw)} m, ${compass(shown, rawNow)} felé`}; a telefon szerinti pontosság: ${last.raw.acc == null ? "ismeretlen" : `±${fmt(last.raw.acc, 0)} m`}; forrás: ${last.raw.src === "network" ? "hálózat" : "műhold"}`);
  if (last.anchor) { const da = metersBetween(shown, last.anchor); L.push(`• Horgony a jelölőtől: ${da < 1 ? "ugyanott" : `${fmt(da)} m, ${compass(shown, last.anchor)} felé`}`); }
  L.push(`• Térkép: ${ctx.orientation === "heading" ? "haladási irány felül" : "észak felül"}, követés: ${ctx.following ? "be" : "ki"}, útvonal: ${ctx.trails ? "be" : "ki"}, hibakereső réteg: ${ctx.debugLayer ? "be" : "ki"}, téma: ${ctx.theme}`);
  L.push(`• Megosztás: ${ctx.sharing ? "be" : "ki"}, GPS-állapot: ${ctx.gpsStatus}, képernyő: ${ctx.visible ? "látszik" : "háttérben"}`);
  L.push("• Rétegek: kék = szűrt jelölő, piros pont = utolsó nyers GPS-fix, piros kör = jelentett pontosság, szürke pontok = előző ~60 nyers fix, zöld gyűrű = horgony.");
  L.push("");

  L.push("2) MIT GONDOL A NAPLÓ (automatikus)");
  for (const d of diagnose(es)) L.push(`${d.level === "warn" ? "⚠" : "•"} ${d.text}`);
  L.push("");

  const first = es[0]!;
  const offs = es.filter((e) => !e.dropped).map((e) => metersBetween({ lat: e.out.lat, lng: e.out.lng }, { lat: e.raw.lat, lng: e.raw.lng }));
  const accAll = es.map((e) => e.raw.acc).filter((x): x is number => x != null);
  const srcNet = es.filter((e) => e.raw.src === "network").length;
  L.push("3) ÖSSZEFOGLALÓ");
  L.push(`• Időszak: ${clock(first.at)} – ${clock(last.at)} (${fmt((last.at - first.at) / 60000, 0)} perc), ${es.length} fix, ebből ${es.filter((e) => e.dropped).length} eldobva (pontosság-hierarchia), ${srcNet} hálózati`);
  L.push(`• Jelentett pontosság: legjobb ±${fmt(Math.min(...accAll, 999), 0)} m, medián ±${fmt(median(accAll), 0)} m, legrosszabb ±${fmt(Math.max(0, ...accAll), 0)} m`);
  L.push(`• Nyers GPS és jelölő távolsága: medián ${fmt(median(offs))} m, 90%-os ${fmt(pct(offs, 0.9))} m, legnagyobb ${fmt(Math.max(0, ...offs))} m`);
  const modeChanges = es.filter((e, i) => i > 0 && e.out.mode !== es[i - 1]!.out.mode).length;
  L.push(`• Mozgás/állás váltás: ${modeChanges} alkalom`);
  L.push("");

  const events = es.filter((e) => e.note);
  L.push(`4) ESEMÉNYEK (a szűrő döntései, legutóbbi ${Math.min(40, events.length)} / ${events.length})`);
  if (!events.length) L.push("(nem volt esemény)");
  for (const e of events.slice(-40)) L.push(`${clock(e.at)}  ${e.out.mode === "still" ? "áll   " : "mozog "} ${e.note}`);
  L.push("");

  L.push("5) ÁTTEKINTÉS 30 MÁSODPERCENKÉNT (utolsó 15 perc; nyers GPS medián a jelölőhöz képest)");
  L.push("idő      | nyers K/É (m)  | ±acc | jelölő→nyers | mód");
  const from = last.at - 15 * 60000;
  const buckets = new Map<number, DebugEntry[]>();
  for (const e of es) if (e.at >= from && !e.dropped) { const k = Math.floor(e.at / 30000); (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(e); }
  for (const [k, b] of [...buckets.entries()].sort((a, c) => a[0] - c[0])) {
    const xs = b.map((e) => toLocal(shown, { lat: e.raw.lat, lng: e.raw.lng }));
    const mx = median(xs.map((v) => v.x)), my = median(xs.map((v) => v.y));
    const own = b.map((e) => toLocal(shown, { lat: e.out.lat, lng: e.out.lng }));
    const d = Math.hypot(mx - median(own.map((v) => v.x)), my - median(own.map((v) => v.y)));
    const ac = median(b.map((e) => e.raw.acc).filter((x): x is number => x != null));
    L.push(`${clock(k * 30000)} | ${fmt(mx, 0).padStart(5)} /${fmt(my, 0).padStart(5)} | ${fmt(ac, 0).padStart(4)} | ${fmt(d, 0).padStart(5)} m      | ${b[b.length - 1]!.out.mode === "still" ? "áll" : "mozog"}`);
  }
  L.push("");

  L.push("6) UTOLSÓ 90 MÁSODPERC FIXENKÉNT");
  L.push("idő      | nyers K/É (m) | ±acc | Doppler km/h | src | jelölő K/É (m) | mód");
  for (const e of es.filter((x) => last.at - x.at <= 90000)) {
    const r = toLocal(shown, { lat: e.raw.lat, lng: e.raw.lng }), o = toLocal(shown, { lat: e.out.lat, lng: e.out.lng });
    L.push(`${clock(e.at)} | ${fmt(r.x, 0).padStart(5)} /${fmt(r.y, 0).padStart(5)} | ${e.raw.acc == null ? "  – " : fmt(e.raw.acc, 0).padStart(4)} | ${kmhText(e.raw.speed).padStart(5)}${e.raw.stepping ? " lép" : "    "} | ${e.raw.src === "network" ? "net" : "gps"} | ${fmt(o.x, 0).padStart(5)} /${fmt(o.y, 0).padStart(5)} | ${e.dropped ? "eldobva" : e.out.mode === "still" ? "áll" : "mozog"}`);
  }
  return L.join("\n");
}

/* ---- rajz (SVG) ------------------------------------------------------------------------------------ */

export function buildPlotSvg(es: DebugEntry[]): string {
  const last = es[es.length - 1];
  const W = 360, H = 360, C = 180;
  if (!last) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"></svg>`;
  const shown = { lat: last.out.lat, lng: last.out.lng };
  const win = es.filter((e) => last.at - e.at <= 10 * 60000 && !e.dropped);
  const pts = win.flatMap((e) => [toLocal(shown, { lat: e.raw.lat, lng: e.raw.lng }), toLocal(shown, { lat: e.out.lat, lng: e.out.lng })]);
  const ext = Math.max(15, ...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 1.15;
  const k = (C - 24) / ext;
  const X = (p: XY) => (C + p.x * k).toFixed(1), Y = (p: XY) => (C - p.y * k).toFixed(1);
  const step = ext > 120 ? 50 : ext > 50 ? 20 : ext > 25 ? 10 : 5;
  let g = "";
  for (let r = step; r < ext; r += step) g += `<circle cx="${C}" cy="${C}" r="${(r * k).toFixed(1)}" fill="none" stroke="#3a4260" stroke-dasharray="3 4"/><text x="${C + 3}" y="${(C - r * k - 2).toFixed(1)}" fill="#7d86a8" font-size="9">${r} m</text>`;
  g += `<line x1="${C}" y1="14" x2="${C}" y2="${H - 14}" stroke="#2c3350"/><line x1="14" y1="${C}" x2="${W - 14}" y2="${C}" stroke="#2c3350"/>`;
  g += `<text x="${C - 4}" y="12" fill="#9aa3c7" font-size="11">É</text><text x="${W - 12}" y="${C - 4}" fill="#9aa3c7" font-size="11">K</text>`;
  // nyers pontok: régebbi = halványabb
  win.forEach((e, i) => {
    const p = toLocal(shown, { lat: e.raw.lat, lng: e.raw.lng });
    const a = 0.15 + 0.6 * (i / Math.max(1, win.length - 1));
    g += `<circle cx="${X(p)}" cy="${Y(p)}" r="2.2" fill="#c9cfe8" fill-opacity="${a.toFixed(2)}"/>`;
  });
  // jelölő nyomvonala
  const trail = win.map((e) => { const p = toLocal(shown, { lat: e.out.lat, lng: e.out.lng }); return `${X(p)},${Y(p)}`; });
  if (trail.length > 1) g += `<polyline points="${trail.join(" ")}" fill="none" stroke="#38bdf8" stroke-width="1.6" stroke-opacity="0.8"/>`;
  // horgonyok (változások)
  let prevA = "";
  for (const e of win) if (e.anchor) { const p = toLocal(shown, e.anchor); const key = `${X(p)},${Y(p)}`; if (key !== prevA) { g += `<circle cx="${X(p)}" cy="${Y(p)}" r="5" fill="none" stroke="#34d399" stroke-width="1.5" stroke-opacity="0.7"/>`; prevA = key; } }
  // pontossági kör + utolsó nyers pont
  const r0 = toLocal(shown, { lat: last.raw.lat, lng: last.raw.lng });
  if (last.raw.acc != null) g += `<circle cx="${X(r0)}" cy="${Y(r0)}" r="${(last.raw.acc * k).toFixed(1)}" fill="#f87171" fill-opacity="0.10" stroke="#f87171" stroke-opacity="0.6"/>`;
  g += `<line x1="${C}" y1="${C}" x2="${X(r0)}" y2="${Y(r0)}" stroke="#f87171" stroke-dasharray="4 3"/><circle cx="${X(r0)}" cy="${Y(r0)}" r="4.5" fill="#f87171"/>`;
  g += `<circle cx="${C}" cy="${C}" r="6" fill="#38bdf8" stroke="#fff" stroke-width="1.5"/>`;
  const legend = `<g font-size="10" fill="#c9cfe8"><circle cx="14" cy="${H - 38}" r="4" fill="#38bdf8"/><text x="24" y="${H - 35}">szűrt jelölő (most)</text><circle cx="14" cy="${H - 24}" r="3" fill="#c9cfe8"/><text x="24" y="${H - 21}">nyers GPS (10 perc, halványabb = régebbi)</text><circle cx="14" cy="${H - 10}" r="4" fill="#f87171"/><text x="24" y="${H - 7}">utolsó nyers fix + pontossági kör</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:420px;background:#12161f;border-radius:16px" font-family="sans-serif">${g}${legend}</svg>`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function buildReportHtml(es: DebugEntry[], ctx: ScreenContext, now = Date.now()): string {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private Place napló</title></head><body style="margin:0;padding:12px;background:#0d1017;color:#e6e9f5;font-family:sans-serif"><h2 style="margin:4px 0 10px">Private Place – napló</h2>${buildPlotSvg(es)}<p style="font-size:12px;color:#9aa3c7">A pontok a napló készítésekor mutatott jelölőhöz (kék) képest vannak; É felül, K jobbra.</p><pre style="font:11px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow-x:auto">${esc(buildReport(es, ctx, now))}</pre></body></html>`;
}

/* ---- küldés ---------------------------------------------------------------------------------------- */

export type DeliverResult = "shared" | "copied" | "downloaded" | "cancelled" | "failed";

/** Megosztás a rendszer megosztólapjával (fájl + szöveg); ha az nincs, vágólap, végül letöltés. */
export async function deliverReport(text: string, html: string, stamp: string, opts: { textOnly?: boolean } = {}): Promise<DeliverResult> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const title = "Private Place napló";
  const cancelled = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
  if (!opts.textOnly) {
    try {
      const file = new File([html], `privateplace-naplo-${stamp}.html`, { type: "text/html" });
      if (nav.share && nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], title, text: "Private Place napló (a képet és a részleteket a csatolt fájl tartalmazza)" }); return "shared"; }
    } catch (e) { if (cancelled(e)) return "cancelled"; }
    try { if (nav.share) { await nav.share({ title, text }); return "shared"; } } catch (e) { if (cancelled(e)) return "cancelled"; }
  }
  try { await navigator.clipboard.writeText(text); return "copied"; } catch { /* tovább */ }
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `privateplace-naplo-${stamp}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    return "downloaded";
  } catch { return "failed"; }
}
