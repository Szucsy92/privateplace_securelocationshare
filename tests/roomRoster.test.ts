import { expect, test } from "bun:test";
import { dropRoster, keepAvatars, keepRosters, MAX_AVATAR_STORE_CHARS, MAX_ROSTER_PER_ROOM, removeMember, setAvatar, touchMember, upsertMember, type Rosters } from "../src/lib/roomRoster";

const TOKEN = "ABCDEFGHJKLMNPQRSTUV";
const SELF = "self-device-1";

test("a bemutatkozó bekerül a névsorba, a saját eszköz soha", () => {
  let r: Rosters = {};
  r = upsertMember(r, TOKEN, { deviceId: "peer-device-1", name: "Anna" }, 1000, SELF);
  r = upsertMember(r, TOKEN, { deviceId: SELF, name: "Én" }, 1000, SELF);
  expect(r[TOKEN]?.map((e) => e.deviceId)).toEqual(["peer-device-1"]);
});

test("az ismételt bemutatkozás frissíti a nevet és az utolsó látást, az első látás megmarad", () => {
  let r = upsertMember({}, TOKEN, { deviceId: "peer-device-1", name: "Anna" }, 1000, SELF);
  r = upsertMember(r, TOKEN, { deviceId: "peer-device-1", name: "Anna K." }, 9000, SELF);
  expect(r[TOKEN]).toEqual([{ deviceId: "peer-device-1", name: "Anna K.", firstSeen: 1000, lastSeen: 9000 }]);
});

test("a lekapcsolódás az utolsó látást frissíti, ismeretlen tagot nem vesz fel", () => {
  let r = upsertMember({}, TOKEN, { deviceId: "peer-device-1", name: "Anna" }, 1000, SELF);
  r = touchMember(r, TOKEN, "peer-device-1", 5000);
  r = touchMember(r, TOKEN, "unknown-dev-1", 6000);
  expect(r[TOKEN]).toEqual([{ deviceId: "peer-device-1", name: "Anna", firstSeen: 1000, lastSeen: 5000 }]);
});

test("a tag törölhető a névsorból, és a szoba névsora is eldobható", () => {
  let r = upsertMember({}, TOKEN, { deviceId: "peer-device-1", name: "Anna" }, 1000, SELF);
  r = upsertMember(r, TOKEN, { deviceId: "peer-device-2", name: "Béla" }, 1000, SELF);
  r = removeMember(r, TOKEN, "peer-device-1");
  expect(r[TOKEN]?.map((e) => e.deviceId)).toEqual(["peer-device-2"]);
  expect(dropRoster(r, TOKEN)[TOKEN]).toBeUndefined();
});

test("csak a megtartott szobák névsora marad meg", () => {
  const other = "23456789ABCDEFGHJKLM";
  let r = upsertMember({}, TOKEN, { deviceId: "peer-device-1", name: "Anna" }, 1000, SELF);
  r = upsertMember(r, other, { deviceId: "peer-device-2", name: "Béla" }, 1000, SELF);
  expect(Object.keys(keepRosters(r, [other]))).toEqual([other]);
});

test("a névsor mérete szobánként korlátos", () => {
  let r: Rosters = {};
  for (let i = 0; i < MAX_ROSTER_PER_ROOM + 20; i++) r = upsertMember(r, TOKEN, { deviceId: `peer-device-${i}`, name: "T" }, i, SELF);
  expect(r[TOKEN]?.length).toBe(MAX_ROSTER_PER_ROOM);
});

const PIC = (n: number) => `data:image/png;base64,${"A".repeat(n)}`;

test("a profilkép eszközazonosító szerint tárolódik, változatlan képnél nem készül új objektum", () => {
  const a = setAvatar({}, "peer-device-1", PIC(10));
  expect(a["peer-device-1"]).toBe(PIC(10));
  expect(setAvatar(a, "peer-device-1", PIC(10))).toBe(a);
});

test("érvénytelen kép nem tárolódik, a null törli a meglévőt", () => {
  const a = setAvatar({}, "peer-device-1", PIC(10));
  expect(setAvatar(a, "peer-device-1", "https://pelda.hu/kep.png")["peer-device-1"]).toBeUndefined();
  expect(setAvatar(a, "peer-device-1", null)["peer-device-1"]).toBeUndefined();
  expect(setAvatar({}, "rovid", PIC(10))).toEqual({});
});

test("a képtároló mérete korlátos: a legrégebben frissített kép törlődik, a legújabb marad", () => {
  const big = PIC(Math.floor(MAX_AVATAR_STORE_CHARS * 0.6));
  let a = setAvatar({}, "peer-device-1", big);
  a = setAvatar(a, "peer-device-2", big + "A");
  expect(a["peer-device-1"]).toBeUndefined();
  expect(a["peer-device-2"]).toBe(big + "A");
});

test("csak a névsorban szereplő tagok képei maradnak meg", () => {
  let a = setAvatar({}, "peer-device-1", PIC(10));
  a = setAvatar(a, "peer-device-2", PIC(10));
  const kept = keepAvatars(a, new Set(["peer-device-2"]));
  expect(Object.keys(kept)).toEqual(["peer-device-2"]);
});
