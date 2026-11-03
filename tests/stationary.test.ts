import { expect, test } from "bun:test";
import { updateStop, stopLabel } from "../src/lib/stationary";
test("five minute stationary label is compact", () => {
  expect(stopLabel(1000, 301000)).toBe("5 perce");
});
test("one hour stationary label is compact", () => {
  expect(stopLabel(1000, 3601000)).toBe("1 órája");
});
test("moving restarts the stop clock", () => {
  expect(updateStop({ anchor: { lat: 47, lng: 19 }, since: 1000 }, { lat: 47, lng: 19 }, 1, 5, 5000).since).toBe(5000);
});
test("small GPS drift does not restart the clock", () => {
  expect(updateStop({ anchor: { lat: 47, lng: 19 }, since: 1000 }, { lat: 47.00001, lng: 19 }, 0, 5, 5000).since).toBe(1000);
});
import { createDriftFilter } from "../src/lib/stationary";
test("álló helyzetben a zajos fixek a horgonyra szűrődnek", () => {
  const f = createDriftFilter();
  const first = f({ lat: 47, lng: 19, acc: 8, speed: 0, at: 1000 });
  const jitter = f({ lat: 47.00006, lng: 19.00004, acc: 8, speed: 0, at: 2000 });
  expect([jitter.lat, jitter.lng]).toEqual([first.lat, first.lng]);
});
test("tartós elmozdulás után a szűrő követi az új pozíciót", () => {
  const f = createDriftFilter();
  f({ lat: 47, lng: 19, acc: 5, speed: 0, at: 1000 });
  let out = f({ lat: 47.001, lng: 19, acc: 5, speed: 0, at: 2000 });
  out = f({ lat: 47.001, lng: 19, acc: 5, speed: 0, at: 3000 });
  out = f({ lat: 47.001, lng: 19, acc: 5, speed: 0, at: 4000 });
  expect(out.lat).toBe(47.001);
});
test("mozgás közben a fix változatlanul átmegy", () => {
  const f = createDriftFilter();
  f({ lat: 47, lng: 19, acc: 5, speed: 0, at: 1000 });
  expect(f({ lat: 47.0001, lng: 19, acc: 5, speed: 1.5, at: 2000 }).lat).toBe(47.0001);
});
test("pontatlan hálózati fix nem írja felül a friss jó GPS-fixet", () => {
  const f = createDriftFilter();
  f({ lat: 47, lng: 19, acc: 6, speed: 1.5, at: 1000 });
  expect(f({ lat: 47.01, lng: 19.01, acc: 800, speed: null, at: 3000 }).lat).toBe(47);
});

test("30-50 méteres, váltakozó GPS-zaj nem húzza el a horgonyt", () => {
  const f = createDriftFilter();
  const base = { lat: 47, lng: 19 };
  let out = f({ ...base, acc: 8, speed: 0, at: 1000 });
  // 30–50 m-es, de nem tartósan egy irányba mutató zaj.
  const offsets = [35, -32, 44, -40, 28, -36, 42, -30, 38, -45];
  offsets.forEach((meters, i) => {
    out = f({
      lat: base.lat + meters / 110540,
      lng: base.lng,
      acc: 8,
      speed: 0,
      at: 2000 + i * 1000,
    });
  });
  expect(Math.abs(out.lat - base.lat) * 110540).toBeLessThan(10);
});
