import { parseRoomInput, type SavedRoom } from "./rooms";

export type Invitation = NonNullable<ReturnType<typeof parseRoomInput>>;
export type AppRelease = { versionCode: number; version: string; apk: string };
const PENDING_KEY = "privateplace.invitation.v1";
export function saveInvitation(invitation: Invitation | null) {
  if (invitation) localStorage.setItem(PENDING_KEY, JSON.stringify(invitation));
  else localStorage.removeItem(PENDING_KEY);
}
export function loadInvitation(): Invitation | null {
  try {
    const item = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null");
    if (!item) return null;
    const params = new URLSearchParams({ szoba: item.token, nev: item.name ?? "", szin: item.color ?? "", gazda: item.ownerKey ?? "" });
    return parseRoomInput(`#${params}`);
  } catch { return null; }
}
export function needsUpdate(installedCode: number, latestCode: number): boolean {
  return Number.isInteger(installedCode) && Number.isInteger(latestCode) && latestCode > installedCode;
}
export function validApkUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "github.com" && /\/releases\/(download|latest\/download)\/.+\.apk$/.test(url.pathname); } catch { return false; }
}
export async function latestRelease(signal?: AbortSignal): Promise<AppRelease | null> {
  const repo = import.meta.env["VITE_RELEASE_REPOSITORY"] as string | undefined;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, signal ? { signal } : {});
  if (!response.ok) throw new Error("Release unavailable");
  const data = await response.json() as { assets?: { name: string; browser_download_url: string }[] };
  const meta = data.assets?.find((a) => a.name === "private-place-release.json");
  const apk = data.assets?.find((a) => a.name === "private-place-latest.apk");
  if (!meta || !apk || !validApkUrl(apk.browser_download_url)) return null;
  const metadata = await fetch(meta.browser_download_url, signal ? { signal } : {});
  if (!metadata.ok) return null;
  const values = await metadata.json() as AppRelease;
  return Number.isInteger(values.versionCode) && typeof values.version === "string" ? { versionCode: values.versionCode, version: values.version, apk: apk.browser_download_url } : null;
}
export function invitationHash(room: SavedRoom): string {
  const params = new URLSearchParams({ szoba: room.token, nev: room.name, szin: room.color ?? "mint" });
  if (room.ownerKey) params.set("gazda", room.ownerKey);
  return params.toString();
}
export function openInstalledApp(invitation: Invitation) {
  const params = new URLSearchParams({ szoba: invitation.token, nev: invitation.name ?? "", szin: invitation.color ?? "mint" });
  if (invitation.ownerKey) params.set("gazda", invitation.ownerKey);
  window.location.assign(`privateplace://join#${params}`);
}