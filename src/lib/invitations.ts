import { parseRoomInput } from "./rooms";

export type Invitation = NonNullable<ReturnType<typeof parseRoomInput>>;
export type AppRelease = { versionCode: number; version: string; apk: string };

const REPO_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

/** A kiadások helye: az appba építve, vagy a meghívó rejtett részében („forras”). */
export function releaseRepository(hash?: string): string | null {
  const built = import.meta.env["VITE_RELEASE_REPOSITORY"] as string | undefined;
  if (built && REPO_RE.test(built)) return built;
  if (!hash) return null;
  const value = new URLSearchParams(hash.slice(hash.indexOf("#") + 1)).get("forras");
  return value && REPO_RE.test(value) ? value : null;
}

export function needsUpdate(installedCode: number, latestCode: number): boolean {
  return Number.isInteger(installedCode) && Number.isInteger(latestCode) && latestCode > installedCode;
}

export function validApkUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && /\/releases\/download\/[^/]+\/[\w.-]+\.apk$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** A kiadás címkéje (build-2026-10-22_0846-12) a futás sorszámával végződik: ez az Android versionCode. */
export function buildFromTag(tag: string): number | null {
  const match = /-(\d+)$/.exec(tag);
  return match ? Number(match[1]) : null;
}

type ReleaseData = { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };

/** A kiadásból a letölthető APK és a build száma; null, ha nincs APK vagy nem olvasható a címke. */
export function pickRelease(data: ReleaseData): AppRelease | null {
  const build = buildFromTag(data.tag_name ?? "");
  const apk = data.assets?.find((a) => a.name === "private-place-latest.apk") ?? data.assets?.find((a) => a.name.endsWith(".apk"));
  if (build === null || !apk || !validApkUrl(apk.browser_download_url)) return null;
  return { versionCode: build, version: `#${build}`, apk: apk.browser_download_url };
}

/** A legújabb aláírt APK adatai a GitHub kiadásokból (saját szerver nélkül). Hiba esetén kivételt dob. */
export async function latestRelease(repo: string, signal?: AbortSignal): Promise<AppRelease | null> {
  if (!REPO_RE.test(repo)) return null;
  const init: RequestInit = { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" };
  if (signal) init.signal = signal;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, init);
  if (!response.ok) throw new Error(`status ${response.status}`);
  return pickRelease((await response.json()) as ReleaseData);
}

export function appLink(invitation: Invitation): string {
  const params = new URLSearchParams({ szoba: invitation.token });
  if (invitation.name) params.set("nev", invitation.name);
  if (invitation.color) params.set("szin", invitation.color);
  if (invitation.ownerKey) params.set("gazda", invitation.ownerKey);
  return `privateplace://join#${params.toString()}`;
}

export const isAndroidBrowser = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
