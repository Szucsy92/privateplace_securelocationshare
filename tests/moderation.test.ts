import { expect, test } from "bun:test";
import { createRoomAuthority, signRoomControl, verifyRoomControl } from "../src/lib/moderation";
import { buildRoomLink, generateRoomToken, parseRoomInput } from "../src/lib/rooms";

test("csak a létrehozó kulcsával aláírt szobatörlés fogadható el", async () => {
  const owner = await createRoomAuthority();
  const other = await createRoomAuthority();
  const token = generateRoomToken();
  const control = await signRoomControl(token, owner, "close", null);
  expect(await verifyRoomControl(control, owner.ownerKey)).toBe(true);
  expect(await verifyRoomControl(control, other.ownerKey)).toBe(false);
  expect(await verifyRoomControl({ ...control, token: generateRoomToken() }, owner.ownerKey)).toBe(false);
  expect(signRoomControl(token, { ownerKey: owner.ownerKey }, "close", null)).rejects.toThrow("Owner only");
});

test("a meghívó csak az ellenőrző kulcsot viszi a rejtett részben", async () => {
  const owner = await createRoomAuthority();
  const token = generateRoomToken();
  const link = buildRoomLink("https://pelda.hu", token, "Család", "mint", owner.ownerKey);
  expect(parseRoomInput(link)?.ownerKey).toBe(owner.ownerKey);
  expect(link.split("#")[0]).toBe("https://pelda.hu/");
  expect(link).not.toContain("privateKey");
});