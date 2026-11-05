import { expect, test } from "bun:test";
import { updateStop, stopLabel, createDriftFilter, type RawFix } from "../src/lib/stationary";

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

test("álló helyzetben a zajos fixek a horgonyra szűrődnek", () => {
  const f = createDriftFilter();
  const first = f(fx(0, 0, 1));
  const jitter = f(fx(6, 4, 2));
  expect([jitter.lat, jitter.lng]).toEqual([first.lat, first.lng]);
  expect(jitter.mode).toBe("still");
});
test("csendes indításkor az álló jelölő a zajtól mozdulatlan marad", () => {
  const f = createDriftFilter();
  const first = f(fx(0, 0, 1, { speed: 0.1 }));
  [[3, 0], [0, 4], [-3, 2], [2, -4], [-2, -2]].forEach(([n, e], i) => {
    const out = f(fx(n!, e!, 2 + i, { speed: 0.1 }));
    expect([out.lat, out.lng]).toEqual([first.lat, first.lng]);
  });
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

// --- Indulás ---
test("gyalogos Doppler-sebesség két fixen át feloldja az állást, egyetlen nem", () => {
  const f = createDriftFilter();
  for (let t = 1; t <= 10; t++) f(fx(0, 0, t));
  const one = f(fx(1, 0, 11, { speed: 1.3, bearing: 0 }));
  expect(one.mode).toBe("still");                       // egyedi sebességtüske nem indít
  const two = f(fx(2.6, 0, 12, { speed: 1.3, bearing: 0 }));
  expect(two.mode).toBe("moving");
  expect(two.stoppedSince).toBe(null);
});
test("egyetlen Doppler-tüske nem mozdítja az álló jelölőt", () => {
  const f = createDriftFilter();
  for (let t = 1; t <= 10; t++) f(fx(0, 0, t));
  const base = f(fx(0, 0, 11));
  const spike = f(fx(2, 3, 12, { speed: 1.8, bearing: 90 }));
  expect([spike.lat, spike.lng]).toEqual([base.lat, base.lng]);
  const after = f(fx(1, 2, 13, { speed: 0.05 }));
  expect(after.mode).toBe("still");
});
test("jármű indulása (≥ 2,5 m/s) egyetlen fixből is feloldja", () => {
  const f = createDriftFilter();
  for (let t = 1; t <= 10; t++) f(fx(0, 0, t));
  expect(f(fx(3, 0, 11, { speed: 4, bearing: 0 })).mode).toBe("moving");
});
test("a járás-jelzés sebességadat nélkül gyorsan feloldja az állást", () => {
  const f = createDriftFilter();
  for (let t = 1; t <= 10; t++) f(fx(0, 0, t, { speed: null }));
  f(fx(0, 0, 11, { speed: null, stepping: true }));
  expect(f(fx(1, 0, 12, { speed: null, stepping: true })).mode).toBe("moving");
});
test("a járás-jelzés nem ront: a Doppler „áll” felülírja (helyben topogás)", () => {
  const f = createDriftFilter();
  for (let t = 1; t <= 10; t++) f(fx(0, 0, t, { speed: 0.05 }));
  for (let t = 11; t <= 20; t++) expect(f(fx(0, 0, t, { speed: 0.05, stepping: true })).mode).toBe("still");
});
test("sebességadat nélküli, tartós, egyirányú elmozdulást (séta) felismer", () => {
  const f = createDriftFilter();
  for (let t = 1; t <= 10; t++) f(fx(0, 0, t, { speed: null }));
  let mode = "still";
  for (let t = 11; t <= 50; t++) { mode = f(fx((t - 10) * 1.3, 0, t, { speed: null })).mode; if (mode === "moving") break; }
  expect(mode).toBe("moving");
});

// --- Drift, multipath, kiugrás ---
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
  f(fx(0, 0, 1, { speed: null }));
  f(fx(220, 0, 2, { speed: null }));
  expect(f(fx(220, 0, 3, { speed: null })).lat < 47.001).toBe(true);   // 2 fix még kevés
  expect(f(fx(220, 0, 4, { speed: null })).lat > 47.0019).toBe(true);
});
test("hosszú csend után (GPS-kiesés) két egyező távoli fix elég", () => {
  const f = createDriftFilter();
  f(fx(0, 0, 1, { speed: null }));
  f(fx(220, 0, 60, { speed: null }));
  expect(f(fx(220, 0, 61, { speed: null })).lat > 47.0019).toBe(true);
});
test("a műholdjel tartós kiesése után a durva, távoli fix átjut (türelmi idő)", () => {
  const f = createDriftFilter();
  f(fx(0, 0, 1));
  f(fx(150, 0, 27, { acc: 100, speed: null, src: "network" }));
  const out = f(fx(150, 0, 28, { acc: 100, speed: null, src: "network" }));
  expect(out.lat > 47.0012).toBe(true);
});

// --- Indítás / visszatérés ---
test("durva (hálózati) első fixre nem horgonyozunk: a jó GPS-fix lesz az állás alapja", () => {
  const f = createDriftFilter();
  const rough = f(fx(150, 0, 1, { acc: 800, speed: null, src: "network" }));
  expect(rough.mode).toBe("moving");
  const good = f(fx(0, 0, 2));
  expect(good.mode).toBe("still");
  expect(Math.abs(good.lat - 47) < 1e-9).toBe(true);
});
test("az álló-óra a szűrőből jön: az első ‘áll’ bizonyíték idejére visszadátumozva", () => {
  const f = createDriftFilter();
  let out = f(fx(0, 0, 100, { speed: 0.02 }));
  expect(out.stoppedSince).toBe(100000);
  for (let t = 101; t <= 400; t++) out = f(fx(0, 0, t, { speed: 0.02 }));
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
