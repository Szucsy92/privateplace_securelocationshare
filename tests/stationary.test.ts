import { expect, test } from "bun:test";
import { updateStop, stopLabel, createDriftFilter, type RawFix, type FilteredFix } from "../src/lib/stationary";

const M = 1 / 110540; // 1 m szélességi fokban
const fx = (n: number, e: number, t: number, extra: Partial<RawFix> = {}): RawFix => ({ lat: 47 + n * M, lng: 19 + (e * M) / Math.cos((47 * Math.PI) / 180), acc: 6, speed: 0, at: t * 1000, src: "gps", ...extra });

test("five minute stationary label is compact", () => { expect(stopLabel(1000, 301000)).toBe("5 perce"); });
test("one hour stationary label is compact", () => { expect(stopLabel(1000, 3601000)).toBe("1 órája"); });
test("moving restarts the stop clock", () => {
  expect(updateStop({ anchor: { lat: 47, lng: 19 }, since: 1000 }, { lat: 47, lng: 19 }, 1, 5, 5000).since).toBe(5000);
});
test("small GPS drift does not restart the clock", () => {
  expect(updateStop({ anchor: { lat: 47, lng: 19 }, since: 1000 }, { lat: 47.00001, lng: 19 }, 0, 5, 5000).since).toBe(1000);
});

/** Determinisztikus álvéletlen (mulberry32), hogy a szimulált adatsorok reprodukálhatók legyenek. */
function rng(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const distM = (a: { lat: number; lng: number }, n: number, e: number) => Math.hypot((a.lat - 47) / M - n, ((a.lng - 19) / M) * Math.cos((47 * Math.PI) / 180) - e);
/** A (0,0) pontban álló telefon `from..to` mp-ig, enyhe zajjal; az utolsó kimenetet adja vissza. */
function settle(f: ReturnType<typeof createDriftFilter>, from = 1, to = 15, extra: Partial<RawFix> = {}, seed = 1): FilteredFix {
  const r = rng(seed); let out!: FilteredFix;
  for (let t = from; t <= to; t++) out = f(fx(gauss(r) * 1.2, gauss(r) * 1.2, t, { speed: 0.05, ...extra }));
  return out;
}

// --- Indítás: nincs azonnali horgony ---
test("indításkor az első fixből nem lesz azonnali horgony: gyűjtés közben nincs megállás-jelzés", () => {
  const f = createDriftFilter();
  for (let t = 1; t <= 8; t++) { const out = f(fx(0, 0, t, { speed: 0.05 })); expect(out.mode).toBe("moving"); expect(out.stoppedSince).toBe(null); }
});
test("a horgony legalább 5 fixből és ~12 s ablakból áll fel, és a megállás kezdete az ablak elejére datálódik", () => {
  const f = createDriftFilter();
  const early = settle(f, 1, 11);
  expect(early.mode).toBe("moving");
  const out = settle(f, 12, 14);
  expect(out.mode).toBe("still");
  expect(out.stoppedSince).toBe(1000);
});
test("hibás első GPS-fix (40 m-re) nem rögzül rossz horgonynak", () => {
  const f = createDriftFilter();
  f(fx(40, 0, 1, { speed: 0.05 }));
  const out = settle(f, 2, 18);
  expect(out.mode).toBe("still");
  expect(distM(out, 0, 0) < 2.5).toBe(true);
});
test("hibás első két fix (kiugrás-páros) sem húzza el a horgonyt", () => {
  const f = createDriftFilter();
  f(fx(35, 10, 1, { speed: 0.05 })); f(fx(36, 9, 2, { speed: 0.05 }));
  const out = settle(f, 3, 20);
  expect(out.mode).toBe("still");
  expect(distM(out, 0, 0) < 3).toBe(true);
});
test("nem egyező, szétszórt indulási fixekből nem lesz horgony: nincs hamis pontosság (mozgás-állapot, nincs megállás-jelzés)", () => {
  const f = createDriftFilter(); const r = rng(7); let out!: FilteredFix;
  for (let t = 1; t <= 25; t++) out = f(fx((r() - 0.5) * 120, (r() - 0.5) * 120, t, { speed: null, acc: 10 }));
  expect(out.mode).toBe("moving");
  expect(out.stoppedSince).toBe(null);
});
test("a rossz pontosságú (>25 m) fixek nem alapozzák meg a horgonyt", () => {
  const f = createDriftFilter(); let out!: FilteredFix;
  for (let t = 1; t <= 20; t++) out = f(fx(0, 0, t, { speed: 0.05, acc: 28 }));
  expect(out.stoppedSince).toBe(null);          // a gyűjtési ablakban nem lesz horgony; utána a bizonyíték-alapú belépés dönt
});
test("indításkor sebességadat nélküli járás-jelzés (2 fix) mozgásba viszi, nem horgonyoz", () => {
  const f = createDriftFilter(); let out!: FilteredFix;
  for (let t = 1; t <= 6; t++) out = f(fx(t * 1.3, 0, t, { speed: null, stepping: true }));
  expect(out.mode).toBe("moving");
  expect(out.stoppedSince).toBe(null);
});
test("lassú, sebességadat nélküli séta az indításkor nem válik horgonnyá", () => {
  const f = createDriftFilter(); let out!: FilteredFix;
  for (let t = 1; t <= 30; t++) out = f(fx(0, t * 1.0, t, { speed: null }));
  expect(out.mode).toBe("moving");
  expect(out.stoppedSince).toBe(null);
});
test("már induláskor mozgó (Doppler) telefon azonnal követett", () => {
  const f = createDriftFilter();
  const out = f(fx(0, 0, 1, { speed: 1.4, bearing: 90 }));
  expect(out.mode).toBe("moving");
});
test("durva (hálózati) első fixre nem horgonyozunk: a jó GPS-fixekből áll fel az állás", () => {
  const f = createDriftFilter();
  const rough = f(fx(150, 0, 1, { acc: 800, speed: null, src: "network" }));
  expect(rough.mode).toBe("moving");
  const out = settle(f, 2, 20);
  expect(out.mode).toBe("still");
  expect(distM(out, 0, 0) < 2.5).toBe(true);
});

// --- Álló helyzet: zaj, drift ---
test("álló helyzetben a zajos fixek a horgonyra szűrődnek", () => {
  const f = createDriftFilter();
  const anchor = settle(f, 1, 15);
  const jitter = f(fx(6, 4, 16));
  expect([jitter.lat, jitter.lng]).toEqual([anchor.lat, anchor.lng]);
  expect(jitter.mode).toBe("still");
});
test("csendes indítás után az álló jelölő a zajtól mozdulatlan marad", () => {
  const f = createDriftFilter();
  const anchor = settle(f, 1, 15);
  [[3, 0], [0, 4], [-3, 2], [2, -4], [-2, -2]].forEach(([n, e], i) => {
    const out = f(fx(n!, e!, 16 + i, { speed: 0.1 }));
    expect([out.lat, out.lng]).toEqual([anchor.lat, anchor.lng]);
  });
});
test("12–15 m-es lassú állóhelyzeti drift (5 perc) mellett a jelölő egy centit sem mozdul", () => {
  const f = createDriftFilter(); const r = rng(11);
  const anchor = settle(f, 1, 15);
  for (let t = 16; t <= 315; t++) {
    const drift = 13 * Math.sin((2 * Math.PI * t) / 140);     // ±13 m, ~2 perces lengés
    const out = f(fx(drift * 0.8 + gauss(r) * 1.5, drift * 0.6 + gauss(r) * 1.5, t, { speed: 0.05, acc: 8 }));
    expect([out.lat, out.lng]).toEqual([anchor.lat, anchor.lng]);
    expect(out.mode).toBe("still");
  }
});
test("10 m-es multipath-eltolódás 30 s-ig nem követett", () => {
  const f = createDriftFilter(); const r = rng(5);
  const anchor = settle(f, 1, 20);
  for (let t = 21; t <= 50; t++) {
    const out = f(fx(10 + gauss(r) * 1, gauss(r) * 1, t, { speed: 0.05, acc: 8 }));
    expect([out.lat, out.lng]).toEqual([anchor.lat, anchor.lng]);
  }
});
test("10 m-es eltolódás, ami közben a horgonynál is mér a telefon, nem korrigál", () => {
  const f = createDriftFilter(); const r = rng(9);
  const anchor = settle(f, 1, 20); let out = anchor;
  for (let t = 21; t <= 400; t++) out = f(fx((t % 5 === 0 ? 0 : 10) + gauss(r) * 0.8, gauss(r) * 0.8, t, { speed: 0.05, acc: 8 }));
  expect([out.lat, out.lng]).toEqual([anchor.lat, anchor.lng]);
});
test("tartós (3 perc), szűk, a horgonyt nem érintő 10 m-es klaszter kontrolláltan korrigál: finoman csúszik, a megállás ideje megmarad", () => {
  const f = createDriftFilter(); const r = rng(3);
  const anchor = settle(f, 1, 20);
  let out = anchor, maxStep = 0, prev = anchor;
  for (let t = 21; t <= 200; t++) {
    out = f(fx(10 + gauss(r) * 1, gauss(r) * 1, t, { speed: 0.05, acc: 8 }));
    maxStep = Math.max(maxStep, distM(out, (prev.lat - 47) / M, ((prev.lng - 19) / M) * Math.cos((47 * Math.PI) / 180)));
    prev = out;
  }
  expect(distM(out, 10, 0) < 2).toBe(true);
  expect(out.mode).toBe("still");
  expect(out.stoppedSince).toBe(1000);
  expect(maxStep < 3).toBe(true);
});

// --- Indulás ---
test("gyalogos Doppler-sebesség két fixen át feloldja az állást, egyetlen nem", () => {
  const f = createDriftFilter();
  settle(f, 1, 15);
  const one = f(fx(1, 0, 16, { speed: 1.3, bearing: 0 }));
  expect(one.mode).toBe("still");                       // egyedi sebességtüske nem indít
  const two = f(fx(2.6, 0, 17, { speed: 1.3, bearing: 0 }));
  expect(two.mode).toBe("moving");
  expect(two.stoppedSince).toBe(null);
});
test("lassú gyaloglás (0,9 m/s) időben elindul, és a jelölő követi", () => {
  const f = createDriftFilter();
  settle(f, 1, 15);
  let out = f(fx(0.9, 0, 16, { speed: 0.9, bearing: 0 }));
  out = f(fx(1.8, 0, 17, { speed: 0.9, bearing: 0 }));
  expect(out.mode).toBe("moving");
  for (let t = 18; t <= 40; t++) out = f(fx((t - 15) * 0.9, 0, t, { speed: 0.9, bearing: 0 }));
  expect(distM(out, 25 * 0.9, 0) < 4).toBe(true);
});
test("normál gyaloglás (1,4 m/s) folyamatos követés: a hiba végig kicsi, a haladás egyenletes", () => {
  const f = createDriftFilter(); const r = rng(21);
  settle(f, 1, 15);
  let prevN = 0;
  for (let t = 16; t <= 75; t++) {
    const truth = (t - 15) * 1.4;
    const out = f(fx(truth + gauss(r) * 2, gauss(r) * 2, t, { speed: 1.4, bearing: 0, acc: 6 }));
    if (t >= 20) {
      expect(out.mode).toBe("moving");
      expect(distM(out, truth, 0) < 6).toBe(true);
      const n = (out.lat - 47) / M; expect(n >= prevN - 0.5).toBe(true); prevN = n;
    }
  }
});
test("induláskor a Kalman nem a hibás horgonyból, hanem az érett jelölt-klaszterből indul", () => {
  const f = createDriftFilter();
  settle(f, 1, 20);
  for (let t = 21; t <= 40; t++) f(fx(12, 0, t, { speed: 0.05, acc: 6 }));      // 12 m-re stabilan mér, de még nem korrigál
  f(fx(13, 1.2, 41, { speed: 1.3, bearing: 90 }));
  const out = f(fx(13, 2.6, 42, { speed: 1.3, bearing: 90 }));
  expect(out.mode).toBe("moving");
  expect(distM(out, 13, 2.6) < 4).toBe(true);
});
test("egyetlen Doppler-tüske nem mozdítja az álló jelölőt", () => {
  const f = createDriftFilter();
  settle(f, 1, 15);
  const base = f(fx(0, 0, 16));
  const spike = f(fx(2, 3, 17, { speed: 1.8, bearing: 90 }));
  expect([spike.lat, spike.lng]).toEqual([base.lat, base.lng]);
  const after = f(fx(1, 2, 18, { speed: 0.05 }));
  expect(after.mode).toBe("still");
});
test("jármű indulása (≥ 2,5 m/s) egyetlen fixből is feloldja", () => {
  const f = createDriftFilter();
  settle(f, 1, 15);
  expect(f(fx(3, 0, 16, { speed: 4, bearing: 0 })).mode).toBe("moving");
});
test("a járás-jelzés sebességadat nélkül gyorsan feloldja az állást", () => {
  const f = createDriftFilter();
  settle(f, 1, 15, { speed: null });
  f(fx(0, 0, 16, { speed: null, stepping: true }));
  expect(f(fx(1, 0, 17, { speed: null, stepping: true })).mode).toBe("moving");
});
test("a járás-jelzés nem ront: a Doppler „áll” felülírja (helyben topogás)", () => {
  const f = createDriftFilter();
  settle(f, 1, 15);
  for (let t = 16; t <= 30; t++) expect(f(fx(0, 0, t, { speed: 0.05, stepping: true })).mode).toBe("still");
});
test("sebességadat nélküli, tartós, egyirányú elmozdulást (séta) felismer", () => {
  const f = createDriftFilter();
  settle(f, 1, 15, { speed: null });
  let mode = "still";
  for (let t = 16; t <= 55; t++) { mode = f(fx((t - 15) * 1.3, 0, t, { speed: null })).mode; if (mode === "moving") break; }
  expect(mode).toBe("moving");
});

// --- Kiugrás, multipath, jelvesztés, hálózati fix ---
test("hirtelen GPS-kiugrás (50 m, 1 fix) nem ugrik át a szomszédba, sem állva, sem mozgás közben", () => {
  const f = createDriftFilter();
  const anchor = settle(f, 1, 15);
  const jump = f(fx(50, 0, 16, { speed: 0.05, acc: 6 }));
  expect([jump.lat, jump.lng]).toEqual([anchor.lat, anchor.lng]);
  const g = createDriftFilter(); settle(g, 1, 15);
  let out!: FilteredFix;
  for (let t = 16; t <= 40; t++) out = g(fx(t === 30 ? 80 + (t - 15) * 1.4 : (t - 15) * 1.4, 0, t, { speed: 1.4, bearing: 0 }));
  out = g(fx(26 * 1.4, 0, 41, { speed: 1.4, bearing: 0 }));
  expect(distM(out, 26 * 1.4, 0) < 6).toBe(true);
});
test("sebességadat nélkül is: egyetlen 50 m-es kiugrás nem mozdítja az álló jelölőt", () => {
  const f = createDriftFilter();
  const anchor = settle(f, 1, 15, { speed: null });
  const jump = f(fx(50, 0, 16, { speed: null, acc: 6 }));
  expect([jump.lat, jump.lng]).toEqual([anchor.lat, anchor.lng]);
  expect(jump.mode).toBe("still");
  const back = f(fx(0.5, 0.5, 17, { speed: null }));
  expect([back.lat, back.lng]).toEqual([anchor.lat, anchor.lng]);
});
test("rövid multipath-lökés (45 m, 30 s) nem teleportálja az álló jelölőt, ha a Doppler áll-t mond", () => {
  const f = createDriftFilter();
  for (let t = 1; t <= 60; t++) f(fx(0, 0, t, { speed: 0.05 }));
  const base = f(fx(0, 0, 61, { speed: 0.05 }));
  for (let t = 62; t < 92; t++) {
    const out = f(fx(20, 45, t, { speed: 0.05, acc: 12 }));
    expect([out.lat, out.lng]).toEqual([base.lat, base.lng]);
  }
});
test("tartós (45 s+) áthelyeződés Doppler-állás mellett is átvezet az új helyre", () => {
  const f = createDriftFilter();
  for (let t = 1; t <= 20; t++) f(fx(0, 0, t, { speed: 0.05 }));
  let out = f(fx(0, 0, 21, { speed: 0.05 }));
  for (let t = 22; t <= 80; t++) out = f(fx(111, 0, t, { speed: 0.05, acc: 5 }));
  expect(out.lat > 47.0009).toBe(true);
  expect(out.mode).toBe("still");
});
test("sebességadat nélkül három egymást követő távoli fix után átugrik", () => {
  const f = createDriftFilter();
  settle(f, 1, 15, { speed: null });
  f(fx(220, 0, 16, { speed: null }));
  expect(f(fx(220, 0, 17, { speed: null })).lat < 47.001).toBe(true);   // 2 fix még kevés
  expect(f(fx(220, 0, 18, { speed: null })).lat > 47.0019).toBe(true);
});
test("hosszú csend után (GPS-kiesés) két egyező távoli fix elég", () => {
  const f = createDriftFilter();
  settle(f, 1, 15, { speed: null });
  f(fx(220, 0, 80, { speed: null }));
  expect(f(fx(220, 0, 81, { speed: null })).lat > 47.0019).toBe(true);
});
test("GPS-jel elvesztése után egyetlen durva, távoli hálózati fix nem hoz létre hamis pozíciót", () => {
  const f = createDriftFilter();
  const anchor = settle(f, 1, 15);
  const out = f(fx(150, 0, 120, { acc: 100, speed: null, src: "network" }));
  expect([out.lat, out.lng]).toEqual([anchor.lat, anchor.lng]);
  expect(out.mode).toBe("still");
});
test("pontatlan hálózati fix nem írja felül a friss jó GPS-fixet", () => {
  const f = createDriftFilter();
  f(fx(0, 0, 1, { speed: 1.5 }));
  expect(f(fx(1100, 1100, 3, { acc: 800, speed: null, src: "network" })).lat).toBe(47);
});
test("friss jó műholdas fix mellett a 30 m alatti hálózati fix is kimarad", () => {
  const f = createDriftFilter();
  f(fx(0, 0, 1, { acc: 8 }));
  expect(f(fx(110, 0, 5, { acc: 25, speed: null, src: "network" })).lat).toBe(47);
});
test("a műholdjel tartós kiesése után a durva, távoli fix átjut (türelmi idő)", () => {
  const f = createDriftFilter();
  f(fx(0, 0, 1));
  f(fx(150, 0, 27, { acc: 100, speed: null, src: "network" }));
  const out = f(fx(150, 0, 28, { acc: 100, speed: null, src: "network" }));
  expect(out.lat > 47.0012).toBe(true);
});

// --- Megállás-óra ---
test("az álló-óra a szűrőből jön: a gyűjtési ablak elejére visszadátumozva, és végig stabil", () => {
  const f = createDriftFilter();
  let out = settle(f, 100, 113, { speed: 0.02 });
  expect(out.stoppedSince).toBe(100000);
  for (let t = 114; t <= 400; t++) out = f(fx(0, 0, t, { speed: 0.02 }));
  expect(out.stoppedSince).toBe(100000);
});
test("mozgás után az ‘áll’ állapot a bizonyíték-ablak elejétől számít", () => {
  const f = createDriftFilter();
  let out = f(fx(0, 0, 1, { speed: 1.3, bearing: 90 }));
  for (let t = 2; t <= 30; t++) out = f(fx(0, t * 1.3, t, { speed: 1.3, bearing: 90 }));
  expect(out.mode).toBe("moving");
  for (let t = 31; t <= 45; t++) out = f(fx(0, 30 * 1.3, t, { speed: 0.05 }));
  expect(out.mode).toBe("still");
  expect(out.stoppedSince! >= 30000 && out.stoppedSince! <= 37000).toBe(true);
});
test("sorrend-hibás vagy ismétlődő időbélyegű fix nem rontja el az állapotot", () => {
  const f = createDriftFilter();
  const a = f(fx(0, 0, 10));
  const b = f(fx(40, 40, 10));
  const c = f(fx(40, 40, 9));
  expect([b.lat, c.lat]).toEqual([a.lat, a.lat]);
});
