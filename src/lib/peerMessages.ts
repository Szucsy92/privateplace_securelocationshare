/** A telefonok között közvetlenül küldött üzenetek és azok ellenőrzése. */

export type HelloMessage = {
  deviceId: string;
  name: string;
  avatar: string | null;
};

export type LocationMessage = {
  lat: number;
  lng: number;
  t: number;
  acc: number | null;
  speed: number | null;
};

/** null = a küldő kikapcsolta a megosztást. */
export type LocMessage = LocationMessage | null;

const MAX_AVATAR_CHARS = 80_000;

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseHello(data: unknown): HelloMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const deviceId = d["deviceId"];
  const name = d["name"];
  const avatar = d["avatar"];
  if (typeof deviceId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return null;
  const cleanName = typeof name === "string" ? name.trim().slice(0, 40) : "";
  const cleanAvatar =
    typeof avatar === "string" &&
    avatar.length <= MAX_AVATAR_CHARS &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)
      ? avatar
      : null;
  return { deviceId, name: cleanName || "Névtelen", avatar: cleanAvatar };
}

export function parseLocation(data: unknown): LocMessage | undefined {
  if (data === null) return null;
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  const lat = finiteOrNull(d["lat"]);
  const lng = finiteOrNull(d["lng"]);
  const t = finiteOrNull(d["t"]);
  if (lat == null || lng == null || t == null) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  const acc = finiteOrNull(d["acc"]);
  const speed = finiteOrNull(d["speed"]);
  return { lat, lng, t, acc: acc != null && acc >= 0 ? acc : null, speed: speed != null && speed >= 0 ? speed : null };
}

const PALETTE = ["#ffc857", "#7aa2ff", "#ff7ab2", "#8be9fd", "#f78c6c", "#c3a6ff"];
export const SELF_COLOR = "#3ddc97";

export function colorForDevice(deviceId: string): string {
  let h = 0;
  for (let i = 0; i < deviceId.length; i++) h = (h * 31 + deviceId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? PALETTE[0]!;
}
