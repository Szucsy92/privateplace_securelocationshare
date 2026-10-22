import { describe, expect, test } from "bun:test";
import { shouldPublishLocation, appendTrackPoint, shouldTrackOwnPosition, clearTrackHistory } from "../src/lib/tracking";

describe("saját követés és megosztás", () => {
  test("belépve a saját pozíció automatikusan követhető külön kapcsoló nélkül", () => {
    expect(shouldTrackOwnPosition("signed-in-user")).toBe(true);
    expect(shouldTrackOwnPosition(undefined)).toBe(false);
  });
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
  test("előzmények törlésekor a saját aktuális pozíció továbbra is látszik", () => {
    const previous = { lat: 47.4, lng: 19.1, t: 1000 };
    const current = { lat: 47.5, lng: 19.2, t: 2000 };
    expect(clearTrackHistory([previous, current])).toEqual([current]);
    expect(clearTrackHistory([])).toEqual([]);
  });
});