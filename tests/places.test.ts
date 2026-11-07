import { expect, test } from "bun:test";
import { applyPlaces, learnBias, localVector, newPlace, newSpot, nudgeSpot, offsetPoint, sanitizePlaces, type FixLite } from "../src/lib/places";
import { distanceMeters } from "../src/lib/mapMath";

const O = { lat: 46.9, lng: 19.7 };
const still = (at: { lat: number; lng: number }, n = 12, acc = 4): FixLite[] => Array.from({ length: n }, (_, i) => ({ ...offsetPoint(at, (i % 3) * 0.3, (i % 2) * 0.3), acc }));

test("offsetPoint és localVector egymás inverzei", () => {
  const p = offsetPoint(O, 7, -5);
  const v = localVector(O, p);
  expect(Math.abs(v.e - 7) < 0.01 && Math.abs(v.n + 5) < 0.01).toBe(true);
});

test("tanulás: a 7 m-es állandó eltérést megtanulja, és kivonja", () => {
  const spot = newSpot(O, "Szoba");
  const raw = offsetPoint(O, 5, -5);
  const r = learnBias(spot, still(raw));
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const place = { ...newPlace("Ház"), spots: [r.spot] };
  const out = applyPlaces([place], raw);
  expect(distanceMeters(out.point, O) < 1).toBe(true);
  expect(out.spotId).toBe(r.spot.id);
});

test("a korrekció a hely sugarán kívül nem hat, és a szélén nincs ugrás", () => {
  const spot = newSpot(O);
  const raw = offsetPoint(O, 6, 0);
  const r = learnBias(spot, still(raw));
  if (!r.ok) throw new Error("tanulás");
  const place = { ...newPlace("H"), radius: 20, spots: [r.spot] };
  expect(applyPlaces([place], offsetPoint(raw, 25, 0)).shiftM).toBe(0);
  const near = applyPlaces([place], offsetPoint(raw, 19, 0)).shiftM;
  expect(near < 0.5).toBe(true);
  expect(applyPlaces([place], raw).shiftM > 5.9).toBe(true);
});

test("mozgás közbeni, kevés vagy pontatlan fixből nem tanul", () => {
  const spot = newSpot(O);
  const walking: FixLite[] = Array.from({ length: 12 }, (_, i) => ({ ...offsetPoint(O, i * 2, 0), acc: 4 }));
  expect(learnBias(spot, walking).ok).toBe(false);
  expect(learnBias(spot, still(O, 3)).ok).toBe(false);
  expect(learnBias(spot, still(O, 12, 40)).ok).toBe(false);
});

test("túl nagy (>60 m) eltérést nem fogad el", () => {
  expect(learnBias(newSpot(O), still(offsetPoint(O, 80, 0))).ok).toBe(false);
});

test("pontosítás (nudge) törli a tanult eltérést, mert a valódi pont megváltozott", () => {
  const r = learnBias(newSpot(O), still(offsetPoint(O, 4, 0)));
  if (!r.ok) throw new Error("tanulás");
  const moved = nudgeSpot(r.spot, 1, 0);
  expect(moved.bias).toBeNull();
  expect(Math.abs(localVector(r.spot, moved).e - 1) < 0.01).toBe(true);
});

test("sanitizePlaces: hibás adatot eldob, értékeket korlátoz", () => {
  const out = sanitizePlaces([{ id: "a", name: "x".repeat(100), radius: 9999, spots: [{ id: "s", lat: 91, lng: 0 }, { id: "t", lat: 1, lng: 1, bias: { e: 500, n: 0 } }] }, null, { id: 3 }]);
  expect(out.length).toBe(1);
  expect(out[0]!.name.length).toBe(60);
  expect(out[0]!.radius).toBe(100);
  expect(out[0]!.spots.length).toBe(1);
  expect(out[0]!.spots[0]!.bias).toBeNull();
});
