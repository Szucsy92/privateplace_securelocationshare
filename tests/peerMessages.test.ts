import { describe, expect, test } from "bun:test";
import { parseHello, parseLocation, parseShareRequest } from "../src/lib/peerMessages";

describe("bejövő üzenetek ellenőrzése", () => {
  test("a megosztás kikapcsolása (null) eltünteti a helyzetet", () => {
    expect(parseLocation(null)).toBeNull();
  });
  test("érvénytelen koordinátát elutasítunk", () => {
    expect(parseLocation({ lat: 120, lng: 19, t: 1 })).toBeUndefined();
    expect(parseLocation({ lat: "47", lng: 19, t: 1 })).toBeUndefined();
  });
  test("érvényes helyzet átmegy", () => {
    expect(parseLocation({ lat: 47.5, lng: 19.04, t: 5, acc: 4, speed: 1.2 })).toEqual({
      lat: 47.5, lng: 19.04, t: 5, acc: 4, speed: 1.2,
    });
  });
  test("a név legfeljebb 40 karakter, a nem képes avatar elvész", () => {
    const h = parseHello({ deviceId: "abcdef123456", name: "x".repeat(60), avatar: "javascript:alert(1)" });
    expect(h?.name).toHaveLength(40);
    expect(h?.avatar).toBeNull();
  });
  test("azonosító nélküli bemutatkozást elutasítunk", () => {
    expect(parseHello({ name: "Anna" })).toBeNull();
  });
});

describe("megosztáskérés", () => {
  test("only the three transport modes may reach peer state", () => {
    const point = { lat: 47, lng: 19, t: 1000 };
    expect(parseLocation({ ...point, transport: "car" })?.transport).toBe("car");
    expect(parseLocation({ ...point, transport: "<script>" })?.transport).toBeUndefined();
  });
  test("csak a true érték számít kérésnek", () => {
    expect(parseShareRequest(true)).toBe(true);
    expect(parseShareRequest("true")).toBe(false);
    expect(parseShareRequest({ ask: true })).toBe(false);
  });
});

describe("időbélyeg- és bemutatkozás-védelem", () => {
  test("a távoli jövőbeli vagy negatív időbélyeg elutasítva", () => {
    expect(parseLocation({ lat: 47, lng: 19, t: Date.now() + 3_600_000 })).toBeUndefined();
    expect(parseLocation({ lat: 47, lng: 19, t: -1 })).toBeUndefined();
    expect(parseLocation({ lat: 47, lng: 19, t: Date.now() + 30_000 })).toBeDefined();
  });
  test("a want jelző csak pontosan true értékkel marad meg", () => {
    expect(parseHello({ deviceId: "abcdef123456", name: "A", avatar: null, want: true })?.want).toBe(true);
    expect(parseHello({ deviceId: "abcdef123456", name: "A", avatar: null, want: "igen" })?.want).toBeUndefined();
  });
});
