import { describe, expect, test } from "bun:test";
import { parseHello, parseLocation } from "../src/lib/peerMessages";

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
