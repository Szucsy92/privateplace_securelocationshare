import { expect, test } from "bun:test";
import { buildPlotSvg, buildReport, circlePolygon, compass, createDebugRecorder, metersBetween, overlayFrom, type ScreenContext } from "../src/lib/debugLog";
import { createDriftFilter, type RawFix } from "../src/lib/stationary";

const M = 1 / 110540;
const ctx: ScreenContext = { stopText: "14 perce", speedText: "0 km/h", gpsStatus: "live", sharing: true, following: false, orientation: "north", trails: false, debugLayer: true, theme: "dark", visible: true, version: "teszt", userAgent: "UA" };
const raw = (n: number, e: number, t: number, extra: Partial<RawFix> = {}): RawFix => ({ lat: 47 + n * M, lng: 19 + (e * M) / Math.cos((47 * Math.PI) / 180), acc: 8, speed: 0.05, at: 1_700_000_000_000 + t * 1000, src: "gps", ...extra });
function recorded(seconds = 40) {
  const f = createDriftFilter(), rec = createDebugRecorder();
  for (let t = 1; t <= seconds; t++) { const r = raw((t % 3) - 1, (t % 2) - 0.5, t); rec.push(r, f(r)); }
  return rec;
}

test("égtáj: észak, kelet, északkelet", () => {
  const a = { lat: 47, lng: 19 };
  expect(compass(a, { lat: 47.001, lng: 19 })).toBe("É");
  expect(compass(a, { lat: 47, lng: 19.001 })).toBe("K");
  expect(compass(a, { lat: 47.001, lng: 19.0015 })).toBe("ÉK");
});
test("távolság méterben", () => { expect(Math.round(metersBetween({ lat: 47, lng: 19 }, { lat: 47 + 10 * M, lng: 19 }))).toBe(10); });
test("a kör sokszög zárt, és a sugár megfelelő", () => {
  const c = { lat: 47, lng: 19 }, poly = circlePolygon(c, 20, 32);
  expect(poly[0]).toEqual(poly[poly.length - 1]);
  expect(Math.round(metersBetween(c, { lat: poly[8]![1], lng: poly[8]![0] }))).toBe(20);
});
test("a rögzítő korlátozza a méretét és megőrzi az eseményt", () => {
  const rec = createDebugRecorder(5), f = createDriftFilter();
  for (let t = 1; t <= 20; t++) { const r = raw(0, 0, t); rec.push(r, f(r)); }
  expect(rec.entries().length).toBe(5);
});
test("az eltérés-réteg a nyers és a szűrt pont távolságát adja", () => {
  const rec = recorded(), o = overlayFrom(rec.entries())!;
  expect(o.offsetM).toBeCloseTo(metersBetween(o.shown, o.raw), 5);
  expect(o.trail.length).toBeGreaterThan(10);
});
test("a napló nem tartalmaz koordinátát, de tartalmazza a képernyő állapotát és az eseményeket", () => {
  const text = buildReport(recorded(60).entries(), ctx);
  expect(text).not.toMatch(/47[.,]\d{4}/);
  expect(text).not.toMatch(/19[.,]\d{4}/);
  expect(text).toContain("MIT LÁTTÁL A KÉPERNYŐN");
  expect(text).toContain("14 perce");
  expect(text).toContain("Horgony felvéve");
});
test("üres napló nem dob hibát", () => {
  expect(buildReport([], ctx)).toContain("Még nincs rögzített GPS-adat");
  expect(buildPlotSvg([])).toContain("<svg");
});
