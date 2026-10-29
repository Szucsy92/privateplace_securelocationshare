import { expect, test } from "bun:test";
import { freshLocation, acceptMeasurement } from "../src/lib/locationFreshness";
const location = { lat: 47, lng: 19, t: 1000, acc: 5, speed: 0 };
test("a late viewer gets the latest measurement only while it is fresh", () => {
  expect(freshLocation(location, 16000)).toEqual(location);
  expect(freshLocation(location, 16001)).toBeNull();
});
test("replaying an old point does not append a new measurement", () => {
  expect(acceptMeasurement(1000, location)).toBe(false);
  expect(acceptMeasurement(1001, location)).toBe(false);
  expect(acceptMeasurement(999, location)).toBe(true);
});