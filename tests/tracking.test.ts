import { describe, expect, test } from "bun:test";
import { shouldPublishLocation, publishIntervalMs, appendTrackPoint, clearTrackHistory } from "../src/lib/tracking";

describe("saját követés és megosztás", () => {
  test("a saját követés megosztás nélkül nem küld helyadatot", () => {
    expect(shouldPublishLocation(false, 5000, 0)).toBe(false);
  });
  test("a megosztás legfeljebb másodpercenként küld", () => {
    expect(shouldPublishLocation(true, 1999, 1000)).toBe(false);
    expect(shouldPublishLocation(true, 2000, 1000)).toBe(true);
  });
  test("a küldési köz alkalmazkodik: látható 1 mp, háttér 2 mp, álló 4 mp", () => {
    expect(publishIntervalMs({ visible: true, still: false })).toBe(1000);
    expect(publishIntervalMs({ visible: false, still: false })).toBe(2000);
    expect(publishIntervalMs({ visible: true, still: true })).toBe(4000);
    expect(publishIntervalMs({ visible: false, still: true })).toBe(4000);
  });
  test("az álló köz a fogadó frissességi határán (15 mp) belül marad", () => {
    expect(publishIntervalMs({ visible: false, still: true })).toBeLessThan(15000);
  });
  test("a megadott közzel a küldés később enged", () => {
    expect(shouldPublishLocation(true, 4999, 1000, 4000)).toBe(false);
    expect(shouldPublishLocation(true, 5000, 1000, 4000)).toBe(true);
    expect(shouldPublishLocation(false, 9000, 0, 4000)).toBe(false);
  });
  test("a saját nyomvonalban a friss pont megmarad", () => {
    expect(appendTrackPoint([], { lat: 47.5, lng: 19.04, t: 5000 }, 5000)).toEqual([
      { lat: 47.5, lng: 19.04, t: 5000 },
    ]);
  });
  test("előzmények törlésekor a saját aktuális pozíció továbbra is látszik", () => {
    const previous = { lat: 47.4, lng: 19.1, t: 1000 };
    const current = { lat: 47.5, lng: 19.2, t: 2000 };
    expect(clearTrackHistory([previous, current])).toEqual([current]);
    expect(clearTrackHistory([])).toEqual([]);
  });
});