/**
 * Opcionális saját továbbító (TURN) a mobilnetek közötti megbízhatóbb kapcsolathoz.
 * Építéskor adható meg (GitHub titkok: TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL).
 * A továbbító is csak titkosított adatot lát.
 */
export type TurnServer = { urls: string[]; username?: string; credential?: string };

export function parseTurnConfig(
  urls: string | undefined,
  username: string | undefined,
  credential: string | undefined,
): TurnServer[] | undefined {
  const list = (urls ?? "")
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => /^turns?:[^\s]+$/i.test(u));
  if (!list.length) return undefined;
  const server: TurnServer = { urls: list };
  if (username?.trim()) server.username = username.trim();
  if (credential?.trim()) server.credential = credential.trim();
  return [server];
}

export function turnConfigFromEnv(): TurnServer[] | undefined {
  const env = import.meta.env as Record<string, string | undefined>;
  return parseTurnConfig(env["VITE_TURN_URLS"], env["VITE_TURN_USERNAME"], env["VITE_TURN_CREDENTIAL"]);
}
