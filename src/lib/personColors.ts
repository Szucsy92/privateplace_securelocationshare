/**
 * Helyi jelölőszínek: a saját és mások térképjelölő-színe átállítható.
 * Csak ezen a telefonon érvényes, nem küldjük el másnak; mindenki a saját kedve szerint színezhet.
 */
import { COLOR_NAMES, SELECTION_COLORS } from "./palette";

export const SELF_COLOR_KEY = "self";

export type PersonColorOption = { value: string; name: string };

export const PERSON_COLOR_OPTIONS: readonly PersonColorOption[] = [
  ...(Object.keys(SELECTION_COLORS) as (keyof typeof SELECTION_COLORS)[]).map((k) => ({ value: SELECTION_COLORS[k], name: COLOR_NAMES[k] })),
  { value: "#FB923C", name: "Mandarin" },
  { value: "#A3E635", name: "Lime" },
  { value: "#F472B6", name: "Rózsaszín" },
  { value: "#E2E8F0", name: "Gyöngyház" },
];

export type PersonColors = Record<string, string>;

const STORAGE_KEY = "privateplace.person-colors.v1";
const ID_PATTERN = /^(self|[A-Za-z0-9_-]{8,64})$/;
const MAX_ENTRIES = 500;

/** Csak a felajánlott színek fogadhatók el (a szín stílusként kerül a felületre, ezért nem engedünk szabad szöveget). */
export function isPersonColor(value: unknown): value is string {
  return typeof value === "string" && PERSON_COLOR_OPTIONS.some((c) => c.value.toLowerCase() === value.toLowerCase());
}

export function loadPersonColors(): PersonColors {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: PersonColors = {};
    for (const [id, color] of Object.entries(raw as Record<string, unknown>)) {
      if (ID_PATTERN.test(id) && isPersonColor(color)) out[id] = color;
    }
    return out;
  } catch {
    return {};
  }
}

export function savePersonColors(colors: PersonColors) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  } catch {
    /* tele vagy tiltott tárhely: a színek a futás alatt memóriában megmaradnak */
  }
}

/** Szín beállítása; null: vissza az alapszínre. Érvénytelen szín vagy azonosító nem változtat semmit. */
export function setPersonColor(colors: PersonColors, id: string, color: string | null): PersonColors {
  if (!ID_PATTERN.test(id)) return colors;
  if (color === null) {
    if (!(id in colors)) return colors;
    const next = { ...colors };
    delete next[id];
    return next;
  }
  if (!isPersonColor(color) || colors[id] === color) return colors;
  const next = { ...colors };
  delete next[id];
  next[id] = color;
  const keys = Object.keys(next);
  if (keys.length > MAX_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete next[k];
  return next;
}
