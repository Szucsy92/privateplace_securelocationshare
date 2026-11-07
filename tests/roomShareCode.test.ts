import { expect, test } from "bun:test";
import { createRoomAuthority, kicksForRoom, signRoomControl, verifyRoomControl } from "../src/lib/moderation";
import { formatRoomToken, generateRoomToken, parseRoomInput, roomQrValue, roomShareCode } from "../src/lib/rooms";

test("a QR-kód a szobakulcs mellett a gazda ellenőrző kulcsát is viszi, és visszaolvasható", async () => {
  const owner = await createRoomAuthority();
  const token = generateRoomToken();
  const parsed = parseRoomInput(roomQrValue(token, owner.ownerKey));
  expect(parsed?.token).toBe(token);
  expect(parsed?.ownerKey).toBe(owner.ownerKey);
  expect(roomQrValue(token, owner.ownerKey)).not.toContain("privateKey");
});

test("a megosztott kód olvasható csoportosítású, és ownerKey-vel együtt is értelmezhető", async () => {
  const owner = await createRoomAuthority();
  const token = generateRoomToken();
  const code = roomShareCode(token, owner.ownerKey);
  expect(code.startsWith(formatRoomToken(token))).toBe(true);
  const parsed = parseRoomInput(code);
  expect(parsed?.token).toBe(token);
  expect(parsed?.ownerKey).toBe(owner.ownerKey);
});

test("gazdakulcs nélkül a régi kód továbbra is érvényes, a hibás kulcsú kód nem", () => {
  const token = generateRoomToken();
  expect(parseRoomInput(token)?.ownerKey).toBeUndefined();
  expect(parseRoomInput(formatRoomToken(token))?.token).toBe(token);
  expect(roomQrValue(token)).toBe(token);
  expect(parseRoomInput(`${token}.rovid`)).toBeNull();
});

test("a QR-ból kapott kulccsal a gazda aláírt törlése ellenőrizhető", async () => {
  const owner = await createRoomAuthority();
  const token = generateRoomToken();
  const parsed = parseRoomInput(roomQrValue(token, owner.ownerKey));
  const close = await signRoomControl(token, owner, "close", null);
  expect(await verifyRoomControl(close, parsed?.ownerKey ?? "")).toBe(true);
});

test("a szobához tartozó eltávolítások gyűjthetők a továbbadáshoz", () => {
  expect(kicksForRoom(generateRoomToken())).toEqual([]);
});
