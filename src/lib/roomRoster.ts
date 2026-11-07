/**
 * Szobánkénti tagnévsor: mindenki, aki valaha bemutatkozott az adott szobában ezen a telefonon.
 * Csak helyi adat: nem küldjük el másnak, és másoktól sem vesszük át, így egy tag listája nem hozhat vissza senkit.
 * Hogy ki van bent, egyedül a gazda aláírt döntése számít (lásd moderation.ts).
 */

export type RosterEntry = { deviceId: string; name: string; firstSeen: number; lastSeen: number };
export type Rosters = Record<string, RosterEntry[]>;

const STORAGE_KEY = "privateplace.room-roster.v1";
export const MAX_ROSTER_PER_ROOM = 200;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

function valid(e: unknown): e is RosterEntry {
  if (!e || typeof e !== "object") return false;
  const r = e as Record<string, unknown>;
  return typeof r["deviceId"] === "string" && DEVICE_ID.test(r["deviceId"]) && typeof r["name"] === "string"
    && typeof r["firstSeen"] === "number" && Number.isFinite(r["firstSeen"])
    && typeof r["lastSeen"] === "number" && Number.isFinite(r["lastSeen"]);
}

export function loadRosters(): Rosters {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Rosters = {};
    for (const [token, list] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(list)) out[token] = list.filter(valid).slice(-MAX_ROSTER_PER_ROOM);
    }
    return out;
  } catch {
    return {};
  }
}

export function saveRosters(rosters: Rosters) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rosters));
  } catch {
    /* tele vagy tiltott tárhely: a névsor a futás alatt memóriában megmarad */
  }
}

/** Bemutatkozó felvétele vagy frissítése. A saját eszköz sosem kerül a névsorba. */
export function upsertMember(rosters: Rosters, token: string, member: { deviceId: string; name: string }, now: number, selfDeviceId: string | null): Rosters {
  if (member.deviceId === selfDeviceId || !DEVICE_ID.test(member.deviceId)) return rosters;
  const list = rosters[token] ?? [];
  const existing = list.find((e) => e.deviceId === member.deviceId);
  if (existing && existing.name === member.name && now - existing.lastSeen < 1000) return rosters;
  const next = existing
    ? list.map((e) => (e.deviceId === member.deviceId ? { ...e, name: member.name, lastSeen: Math.max(e.lastSeen, now) } : e))
    : [...list, { deviceId: member.deviceId, name: member.name, firstSeen: now, lastSeen: now }].slice(-MAX_ROSTER_PER_ROOM);
  return { ...rosters, [token]: next };
}

/** Az utolsó találkozás időpontjának frissítése (pl. amikor a tag lekapcsolódik). */
export function touchMember(rosters: Rosters, token: string, deviceId: string, now: number): Rosters {
  const list = rosters[token];
  if (!list?.some((e) => e.deviceId === deviceId)) return rosters;
  return { ...rosters, [token]: list.map((e) => (e.deviceId === deviceId ? { ...e, lastSeen: Math.max(e.lastSeen, now) } : e)) };
}

export function removeMember(rosters: Rosters, token: string, deviceId: string): Rosters {
  const list = rosters[token];
  if (!list?.some((e) => e.deviceId === deviceId)) return rosters;
  return { ...rosters, [token]: list.filter((e) => e.deviceId !== deviceId) };
}

export function dropRoster(rosters: Rosters, token: string): Rosters {
  if (!(token in rosters)) return rosters;
  const next = { ...rosters };
  delete next[token];
  return next;
}

/** Csak a megadott szobák névsorai maradnak meg. */
export function keepRosters(rosters: Rosters, tokens: Iterable<string>): Rosters {
  const keep = new Set(tokens);
  const entries = Object.entries(rosters).filter(([token]) => keep.has(token));
  return entries.length === Object.keys(rosters).length ? rosters : Object.fromEntries(entries);
}

/**
 * Profilképek helyi tárolása eszközazonosító szerint, hogy a lekapcsolódott tagok is a saját képükkel jelenjenek meg a névsorban.
 * A sorrend a frissesség: túl nagy tárolónál a legrégebben frissített képek törlődnek.
 */
export type Avatars = Record<string, string>;

const AVATAR_KEY = "privateplace.room-avatars.v1";
export const MAX_AVATAR_STORE_CHARS = 1_000_000;
const AVATAR_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function loadAvatars(): Avatars {
  try {
    const raw = JSON.parse(localStorage.getItem(AVATAR_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Avatars = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (DEVICE_ID.test(id) && typeof value === "string" && AVATAR_PATTERN.test(value)) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAvatars(avatars: Avatars) {
  try {
    localStorage.setItem(AVATAR_KEY, JSON.stringify(avatars));
  } catch {
    /* tele vagy tiltott tárhely: a képek a futás alatt memóriában megmaradnak */
  }
}

/** Kép beállítása; null: a tag eltávolította a profilképét. Változatlan kép esetén ugyanazt az objektumot adja vissza. */
export function setAvatar(avatars: Avatars, deviceId: string, avatar: string | null): Avatars {
  if (!DEVICE_ID.test(deviceId)) return avatars;
  if (avatar === null || !AVATAR_PATTERN.test(avatar)) {
    if (!(deviceId in avatars)) return avatars;
    const next = { ...avatars };
    delete next[deviceId];
    return next;
  }
  if (avatars[deviceId] === avatar) return avatars;
  const next = { ...avatars };
  delete next[deviceId];
  next[deviceId] = avatar;
  let total = Object.values(next).reduce((sum, v) => sum + v.length, 0);
  for (const id of Object.keys(next)) {
    if (total <= MAX_AVATAR_STORE_CHARS || id === deviceId) break;
    total -= next[id]?.length ?? 0;
    delete next[id];
  }
  return next;
}

/** Csak a megadott eszközök képei maradnak meg. */
export function keepAvatars(avatars: Avatars, deviceIds: Set<string>): Avatars {
  const ids = Object.keys(avatars);
  if (ids.every((id) => deviceIds.has(id))) return avatars;
  return Object.fromEntries(Object.entries(avatars).filter(([id]) => deviceIds.has(id)));
}
