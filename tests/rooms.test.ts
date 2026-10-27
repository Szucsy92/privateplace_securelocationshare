import { describe, expect, test } from "bun:test";
import {
  ROOM_TOKEN_LENGTH,
  ROOM_COLORS,
  customizeRoom,
  addRoom,
  buildRoomLink,
  formatRoomToken,
  generateRoomToken,
  parseRoomInput,
  removeRoom,
} from "../src/lib/rooms";

describe("titkos szobák", () => {
  test("minden generált szoba egyedi, 20 jelű kódot kap", () => {
    const a = generateRoomToken();
    const b = generateRoomToken();
    expect(a).toHaveLength(ROOM_TOKEN_LENGTH);
    expect(a).not.toBe(b);
  });

  test("a link és a beírt (csoportosított) kód ugyanarra a szobára mutat", () => {
    const token = generateRoomToken();
    const link = buildRoomLink("https://pelda.hu", token, "Család");
    expect(parseRoomInput(link)).toEqual({ token, name: "Család" });
    expect(parseRoomInput(formatRoomToken(token).toLowerCase())).toEqual({ token, name: null });
  });

  test("hibás vagy rövid kóddal nem lehet csatlakozni", () => {
    expect(parseRoomInput("ABC")).toBeNull();
    expect(parseRoomInput("https://pelda.hu/#szoba=ROVID")).toBeNull();
    expect(parseRoomInput("")).toBeNull();
  });

  test("a szoba törölhető, utána új hozható létre", () => {
    const first = { token: generateRoomToken(), name: "Szobám", owner: true, createdAt: 1 };
    let rooms = addRoom([], first);
    rooms = removeRoom(rooms, first.token);
    expect(rooms).toEqual([]);
    const second = { token: generateRoomToken(), name: "Szobám", owner: true, createdAt: 2 };
    expect(addRoom(rooms, second)).toEqual([second]);
  });

  test("ugyanaz a szoba nem kerül be kétszer", () => {
    const room = { token: generateRoomToken(), name: "X", owner: false, createdAt: 1 };
    expect(addRoom([room], room)).toHaveLength(1);
  });
});

test("pontosan öt különböző szobaszín választható", () => {
  expect(ROOM_COLORS).toHaveLength(5);
  expect(new Set(ROOM_COLORS).size).toBe(5);
});
test("az átnevezés és színváltás nem változtatja meg a titkos szobakódot", () => {
  const room = { token: generateRoomToken(), name: "Szobám", owner: true, createdAt: 1 };
  const edited = customizeRoom([room], room.token, " Család ", "sky");
  expect(edited[0]).toEqual({ ...room, name: "Család", color: "sky" });
  expect(customizeRoom(edited, room.token, "  ", "rose")).toEqual(edited);
});
test("a szobaszín a meghívó rejtett részében utazik", () => {
  const token = generateRoomToken();
  const link = buildRoomLink("https://pelda.hu", token, "Család", "rose");
  expect(parseRoomInput(link)).toEqual({ token, name: "Család", color: "rose" });
  expect(link.split("#")[0]).toBe("https://pelda.hu/");
});
