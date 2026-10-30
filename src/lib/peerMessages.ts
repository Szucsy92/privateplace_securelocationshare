/** A telefonok között közvetlenül küldött üzenetek és azok ellenőrzése. */
import { SELECTION_COLORS } from "./palette";
import type { RoomControl } from "./moderation";
import { isTransportMode, type TransportMode } from "./transport";

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
  heading?: number | null;
  battery?: number | null;
  since?: number | null;
  stoppedSince?: number | null;
  transport?: TransportMode;
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
  const heading = finiteOrNull(d["heading"]);
  const battery = finiteOrNull(d["battery"]);
  const since = finiteOrNull(d["since"]);
  const stoppedSince = finiteOrNull(d["stoppedSince"]);
  return { lat, lng, t, acc: acc != null && acc >= 0 ? acc : null, speed: speed != null && speed >= 0 ? speed : null,
    ...(isTransportMode(d["transport"]) ? { transport: d["transport"] } : {}),
    ...(d["heading"] !== undefined ? { heading: heading !== null && heading >= 0 && heading < 360 ? heading : null } : {}),
    ...(d["battery"] !== undefined ? { battery: battery !== null && battery >= 0 && battery <= 100 ? battery : null } : {}),
    ...(d["since"] !== undefined ? { since: since !== null && since >= 0 && since <= t ? since : null } : {}),
    ...(d["stoppedSince"] !== undefined ? { stoppedSince: stoppedSince !== null && stoppedSince >= 0 && stoppedSince <= t ? stoppedSince : null } : {}),
  };
}

/** Megosztáskérés: csak a pontosan `true` érték érvényes. */
export function parseShareRequest(data: unknown): boolean {
  return data === true;
}

export function parseRoomControl(data: unknown): RoomControl | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if ((d['kind'] !== "close" && d['kind'] !== "kick") || typeof d['token'] !== "string" || !/^[A-HJ-NP-Z2-9]{20}$/.test(d['token'])) return null;
  if (d['kind'] === "close" ? d['target'] !== null : typeof d['target'] !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(d['target'])) return null;
  if (typeof d['at'] !== "number" || !Number.isFinite(d['at']) || d['at'] < 0 || d['at'] > Date.now() + 60000) return null;
  if (typeof d['nonce'] !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(d['nonce']) || typeof d['signature'] !== "string" || !/^[A-Za-z0-9_-]{80,100}$/.test(d['signature'])) return null;
  return { kind: d['kind'] as RoomControl['kind'], token: d['token'] as string, target: d['target'] as string | null, at: d['at'] as number, nonce: d['nonce'] as string, signature: d['signature'] as string };
}

const PALETTE = Object.values(SELECTION_COLORS);
export const SELF_COLOR = SELECTION_COLORS.mint;

export function colorForDevice(deviceId: string): string {
  let h = 0;
  for (let i = 0; i < deviceId.length; i++) h = (h * 31 + deviceId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? SELF_COLOR;
}
