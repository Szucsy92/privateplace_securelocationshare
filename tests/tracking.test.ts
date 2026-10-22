import { describe, expect, test } from "bun:test";
import { shouldPublishLocation, appendTrackPoint } from "../src/lib/tracking";

describe("saját követés és megosztás", () => {
  test("a saját követés megosztás nélkül nem küld helyadatot", () => {
    expect(shouldPublishLocation(false, 5000, 0)).toBe(false);
  });
  test("a megosztás legfeljebb másodpercenként küld", () => {
    expect(shouldPublishLocation(true, 1999, 1000)).toBe(false);
    expect(shouldPublishLocation(true, 2000, 1000)).toBe(true);
  });
  test("a saját nyomvonalban a friss pont megmarad", () => {
    expect(appendTrackPoint([], { lat: 47.5, lng: 19.04, t: 5000 }, 5000)).toEqual([
      { lat: 47.5, lng: 19.04, t: 5000 },
    ]);
  });
});