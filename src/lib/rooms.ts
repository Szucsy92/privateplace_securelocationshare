/**
 * Titkos szobák: a szoba azonosítója egyben a titkos kulcs is.
 * Aki nem kapta meg a kódot vagy a linket, nem tud csatlakozni, és nem is látja a szobát.
 */

export const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_TOKEN_LENGTH = 20;
const STORAGE_KEY = "elohely.rooms.v1";

export type SavedRoom = {
  token: string;
  name: string;
  owner: boolean;
  createdAt: number;
};

export function generateRoomToken(random: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = random(ROOM_TOKEN_LENGTH);
  let out = "";
  for (let i = 0; i < ROOM_TOKEN_LENGTH; i++) {
    out += ROOM_ALPHABET[(bytes[i] ?? 0) % ROOM_ALPHABET.length];
  }
  return out;
}

function defaultRandom(n: number) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Olvasható csoportosítás: ABCDE-FGHJK-… */
export function formatRoomToken(token: string): string {
  return token.match(/.{1,5}/g)?.join("-") ?? token;
}

function normalizeToken(raw: string): string | null {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== ROOM_TOKEN_LENGTH) return null;
  for (const ch of cleaned) if (!ROOM_ALPHABET.includes(ch)) return null;
  return cleaned;
}

/** Link vagy beírt kód értelmezése. */
export function parseRoomInput(input: string): { token: string; name: string | null } | null {
  const text = input.trim();
  if (!text) return null;
  const hashIndex = text.indexOf("#");
  if (hashIndex >= 0) {
    const params = new URLSearchParams(text.slice(hashIndex + 1));
    const raw = params.get("szoba");
    if (raw) {
      const token = normalizeToken(raw);
      if (!token) return null;
      const name = params.get("nev");
      return { token, name: name ? name.slice(0, 40) : null };
    }
  }
  const token = normalizeToken(text);
  return token ? { token, name: null } : null;
}

export function buildRoomLink(base: string, token: string, name?: string): string {
  const params = new URLSearchParams({ szoba: token });
  if (name) params.set("nev", name);
  return `${base.replace(/\/+$/, "")}/#${params.toString()}`;
}

export function loadRooms(): SavedRoom[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as SavedRoom[]) : [];
    return Array.isArray(list) ? list.filter((r) => normalizeToken(r.token) === r.token) : [];
  } catch {
    return [];
  }
}

export function saveRooms(rooms: SavedRoom[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
}

export function addRoom(rooms: SavedRoom[], room: SavedRoom): SavedRoom[] {
  if (rooms.some((r) => r.token === room.token)) return rooms;
  return [...rooms, room];
}

export function removeRoom(rooms: SavedRoom[], token: string): SavedRoom[] {
  return rooms.filter((r) => r.token !== token);
}
