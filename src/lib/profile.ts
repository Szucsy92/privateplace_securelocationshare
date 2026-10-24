/** Helyi profil – csak ezen a telefonon tárolva, regisztráció nélkül. */

const PROFILE_KEY = "elohely.profile.v1";
const DEVICE_KEY = "elohely.device.v1";
const PREFS_KEY = "elohely.prefs.v1";

export type LocalProfile = { name: string; avatar: string | null };
export type Prefs = { sharing: boolean; showTrails: boolean; orientation: "north" | "heading"; mapTheme: "dark" | "light" };

export const DEFAULT_PREFS: Prefs = { sharing: false, showTrails: false, orientation: "north", mapTheme: "dark" };

export function loadProfile(): LocalProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as LocalProfile;
    return typeof p.name === "string" && p.name.trim() ? { name: p.name, avatar: p.avatar ?? null } : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: LocalProfile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/** Kép kicsinyítése kör alakú jelölőhöz (kis méret, hogy gyorsan átküldhető legyen). */
export function resizeAvatar(file: File, size = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}
