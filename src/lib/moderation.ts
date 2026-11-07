export type RoomAuthority = { ownerKey: string; ownerPrivateKey?: JsonWebKey };
export type RoomControl = { kind: "close" | "kick"; token: string; target: string | null; at: number; nonce: string; signature: string };
function encode(bytes: Uint8Array): string { return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join("" )).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function decode(text: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)); }
function payload(control: Omit<RoomControl, "signature">) { return new TextEncoder().encode(JSON.stringify([control.kind, control.token, control.target, control.at, control.nonce])); }
export async function createRoomAuthority(): Promise<RoomAuthority> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { ownerKey: encode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))), ownerPrivateKey: await crypto.subtle.exportKey("jwk", pair.privateKey) };
}
export async function signRoomControl(token: string, authority: RoomAuthority, kind: RoomControl["kind"], target: string | null): Promise<RoomControl> {
  if (!authority.ownerPrivateKey) throw new Error("Owner only");
  const body = { kind, token, target, at: Date.now(), nonce: crypto.randomUUID() };
  const key = await crypto.subtle.importKey("jwk", authority.ownerPrivateKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, payload(body));
  return { ...body, signature: encode(new Uint8Array(signature)) };
}
export async function verifyRoomControl(control: RoomControl, ownerKey: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", decode(ownerKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, decode(control.signature), payload(control));
  } catch { return false; }
}
const CONTROL_KEY = "privateplace.room-controls.v1";
export function loadRoomControls(): RoomControl[] {
  try { const items = JSON.parse(localStorage.getItem(CONTROL_KEY) ?? "[]"); return Array.isArray(items) ? items : []; } catch { return []; }
}
const MAX_CONTROLS = 500;
export function rememberRoomControl(control: RoomControl) {
  const controls = loadRoomControls();
  if (controls.some((c) => c.nonce === control.nonce)) return;
  try { localStorage.setItem(CONTROL_KEY, JSON.stringify([...controls, control].slice(-MAX_CONTROLS))); } catch { /* nem kritikus */ }
}
/** A szobához tartozó, helyben tárolt aláírt eltávolítások (csatlakozó társaknak továbbadjuk, hogy a lemaradt tagok is értesüljenek). */
export function kicksForRoom(token: string, limit = 20): RoomControl[] {
  return loadRoomControls().filter((c) => c.kind === "kick" && c.token === token).slice(-limit);
}
