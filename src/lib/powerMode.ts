import { distanceMeters } from "./mapMath";
import { MOVING_SPEED } from "./stationary";

/** GPS-mérési köz (ms) a natív háttérkövetőben. */
export const ACTIVE_GPS_MS = 1000; // látható képernyő, vagy valaki néz és mozgunk: a drift-szűrő erre az ütemre van hangolva
export const STILL_GPS_MS = 3000; // valaki néz, de álltunk: elég ritkábban mérni, a CPU ébren marad (stabil kapcsolat)
export const IDLE_GPS_MS = 5000; // háttérben és senki nem néz: a legritkább; a CPU alhat a mérések között
/** Ennyi ideig tartó, szűrő által megerősített állás után lehet ritkítani. */
export const CALM_AFTER_MS = 60_000;

export type PowerContext = {
  visible: boolean;
  sharing: boolean;
  /** Legalább egy szobatárs közvetlenül kapcsolódik hozzánk. */
  viewers: boolean;
  /** A szűrő szerint tartósan (CALM_AFTER_MS+) állunk. */
  calm: boolean;
};

/**
 * Mennyi legyen a GPS-mérési köz. Látható képernyőnél mindig 1 mp (sima saját jelölő). Háttérben csak akkor ritkítunk,
 * ha nincs néző, vagy ha tartósan állunk; mozgás közben néző mellett marad az 1 mp, hogy a követés ne romoljon.
 */
export function desiredGpsIntervalMs(ctx: PowerContext): number {
  if (ctx.visible) return ACTIVE_GPS_MS;
  if (!(ctx.sharing && ctx.viewers)) return IDLE_GPS_MS;
  return ctx.calm ? STILL_GPS_MS : ACTIVE_GPS_MS;
}

/**
 * Ritkított mérésnél a drift-szűrő belső ablakai (4 fix / 8 mp) nem tudnak kilépni az „áll” állapotból, ezért a
 * nyers fixből külön észleljük az indulást, és ilyenkor azonnal visszaváltunk 1 mp-re; onnan a szűrő a megszokott módon dönt.
 */
export function movementWake(
  fix: { lat: number; lng: number; speed: number | null; acc: number | null },
  anchor: { lat: number; lng: number } | null,
): boolean {
  if (fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= MOVING_SPEED && (fix.acc === null || fix.acc <= 30)) return true;
  if (!anchor) return false;
  const radius = Math.min(40, Math.max(10, fix.acc ?? 10));
  return distanceMeters(anchor, fix) > radius * 1.5;
}
