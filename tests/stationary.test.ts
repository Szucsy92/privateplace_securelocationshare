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