import { describe, expect, test } from "bun:test";
import { ACTIVE_GPS_MS, IDLE_GPS_MS, STILL_GPS_MS, desiredGpsIntervalMs, movementWake } from "../src/lib/powerMode";

const base = { visible: false, sharing: true, viewers: true, calm: false };

describe("GPS-mérési köz", () => {
  test("látható képernyőnél mindig 1 mp", () => {
    expect(desiredGpsIntervalMs({ ...base, visible: true, viewers: false, calm: true })).toBe(ACTIVE_GPS_MS);
  });
  test("háttérben néző mellett mozgás közben marad az 1 mp", () => {
    expect(desiredGpsIntervalMs(base)).toBe(ACTIVE_GPS_MS);
  });
  test("háttérben néző mellett, tartós állásnál 3 mp", () => {
    expect(desiredGpsIntervalMs({ ...base, calm: true })).toBe(STILL_GPS_MS);
  });
  test("háttérben néző nélkül 5 mp, megosztás nélkül is", () => {
    expect(desiredGpsIntervalMs({ ...base, viewers: false })).toBe(IDLE_GPS_MS);
    expect(desiredGpsIntervalMs({ ...base, sharing: false })).toBe(IDLE_GPS_MS);
  });
  test("a ritkított mérés mindig a fogadó 15 mp-es frissességi határán belül marad", () => {
    expect(IDLE_GPS_MS).toBeLessThan(15000);
  });
});

describe("indulás-észlelés ritkított mérésnél", () => {
  const anchor = { lat: 47.5, lng: 19.04 };
  test("gyalogos tempójú Doppler azonnal ébreszt", () => {
    expect(movementWake({ ...anchor, speed: 1.1, acc: 8 }, anchor)).toBe(true);
  });
  test("álló, jó fix nem ébreszt", () => {
    expect(movementWake({ ...anchor, speed: 0.1, acc: 8 }, anchor)).toBe(false);
  });
  test("pontatlan fix sebessége nem ébreszt, a távolság viszont igen", () => {
    expect(movementWake({ ...anchor, speed: 3, acc: 80 }, anchor)).toBe(false);
    expect(movementWake({ lat: anchor.lat + 0.0005, lng: anchor.lng, speed: null, acc: 8 }, anchor)).toBe(true);
  });
  test("horgony nélkül csak a sebesség számít", () => {
    expect(movementWake({ ...anchor, speed: null, acc: 8 }, null)).toBe(false);
  });
});
