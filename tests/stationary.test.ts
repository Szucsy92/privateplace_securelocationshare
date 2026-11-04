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

test("lassú gyalogos elmozdulást sebességadat nélkül is felismer", () => {
  const f = createDriftFilter();
  f({ lat: 47, lng: 19, acc: 8, speed: 0, at: 1000 });
  f({ lat: 47, lng: 19, acc: 8, speed: 0, at: 2000 });
  f({ lat: 47.00004, lng: 19, acc: 8, speed: null, at: 3000 });
  f({ lat: 47.00008, lng: 19, acc: 8, speed: null, at: 4000 });
  const out = f({ lat: 47.00012, lng: 19, acc: 8, speed: null, at: 5000 });
  expect(out.lat).toBeGreaterThan(47.00005);
});

test("csendes indításkor az álló jelölő a zajtól mozdulatlan marad", () => {
  const f = createDriftFilter();
  const first = f({ lat: 47, lng: 19, acc: 8, speed: 0.1, at: 1000, src: "gps" });
  const offsets: [number, number][] = [[0.00003, 0], [0, 0.00004], [-0.00003, 0.00002], [0.00002, -0.00004], [-0.00002, -0.00002]];
  offsets.forEach(([dy, dx], i) => {
    const out = f({ lat: 47 + dy, lng: 19 + dx, acc: 8, speed: 0.1, at: 2000 + i * 1000, src: "gps" });
    expect([out.lat, out.lng]).toEqual([first.lat, first.lng]);
  });
});
test("friss jó műholdas fix mellett a 30 m alatti hálózati fix is kimarad", () => {
  const f = createDriftFilter();
  f({ lat: 47, lng: 19, acc: 8, speed: 0, at: 1000, src: "gps" });
  expect(f({ lat: 47.001, lng: 19, acc: 25, speed: null, at: 5000, src: "network" }).lat).toBe(47);
});
test("a műholdjel tartós kiesése után a durva fix átjut (türelmi idő)", () => {
  const f = createDriftFilter();
  f({ lat: 47, lng: 19, acc: 8, speed: 0, at: 1000, src: "gps" });
  f({ lat: 47.0005, lng: 19, acc: 100, speed: null, at: 27000, src: "network" });
  const out = f({ lat: 47.0005, lng: 19, acc: 100, speed: null, at: 28000, src: "network" });
  expect(out.lat > 47.0004).toBe(true);
});
test("a gyalogos Doppler-sebesség (1,1 m/s) azonnal feloldja az állást", () => {
  const f = createDriftFilter();
  f({ lat: 47, lng: 19, acc: 6, speed: 0, at: 1000, src: "gps" });
  expect(f({ lat: 47.00001, lng: 19, acc: 6, speed: 1.2, bearing: 0, at: 2000, src: "gps" }).lat).toBe(47.00001);
});
test("egyetlen távoli kiugró fix nem mozdítja az álló jelölőt", () => {
  const f = createDriftFilter();
  f({ lat: 47, lng: 19, acc: 8, speed: 0, at: 1000, src: "gps" });
  expect(f({ lat: 47.001, lng: 19, acc: 8, speed: 0, at: 2000, src: "gps" }).lat).toBe(47);
  expect(f({ lat: 47, lng: 19, acc: 8, speed: 0, at: 3000, src: "gps" }).lat).toBe(47);
});
test("két egymást követő távoli fix után azonnal átugrik az új helyre", () => {
  const f = createDriftFilter();
  f({ lat: 47, lng: 19, acc: 5, speed: null, at: 1000, src: "gps" });
  f({ lat: 47.002, lng: 19, acc: 5, speed: null, at: 2000, src: "gps" });
  expect(f({ lat: 47.002, lng: 19, acc: 5, speed: null, at: 3000, src: "gps" }).lat > 47.0019).toBe(true);
});
