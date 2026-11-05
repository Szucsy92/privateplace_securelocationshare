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

/** A legújabb aláírt APK adatai a GitHub kiadásokból (saját szerver nélkül). */
export async function latestRelease(repo: string, signal?: AbortSignal): Promise<AppRelease | null> {
  if (!REPO_RE.test(repo)) return null;
  const init = signal ? { signal } : {};
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, init);
  if (!response.ok) return null;
  const data = (await response.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
  const meta = data.assets?.find((a) => a.name === "private-place-release.json");
  const apk = data.assets?.find((a) => a.name === "private-place-latest.apk") ?? data.assets?.find((a) => a.name.endsWith(".apk"));
  if (!meta || !apk || !validApkUrl(apk.browser_download_url)) return null;
  const metadata = await fetch(meta.browser_download_url, init).catch(() => null);
  // GitHub release assets may deny browser CORS; the dated tag also ends in the version code.
  const tagCode = Number(data.tag_name?.match(/-(\d+)$/)?.[1] ?? 0);
  if (!metadata?.ok) return { versionCode: tagCode, version: "", apk: apk.browser_download_url };
  const values = (await metadata.json().catch(() => ({}))) as Partial<AppRelease>;
  return {
    versionCode: Number.isInteger(values.versionCode) ? (values.versionCode as number) : tagCode,
    version: typeof values.version === "string" ? values.version.slice(0, 40) : "",
    apk: apk.browser_download_url,
  };
}

export function appLink(invitation: Invitation): string {
  const params = new URLSearchParams({ szoba: invitation.token });
  if (invitation.name) params.set("nev", invitation.name);
  if (invitation.color) params.set("szin", invitation.color);
  if (invitation.ownerKey) params.set("gazda", invitation.ownerKey);
  return `privateplace://join#${params.toString()}`;
}

export const isAndroidBrowser = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
