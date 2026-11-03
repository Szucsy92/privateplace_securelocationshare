type TrackPoint = { lat: number; lng: number; t: number };

/** A nyomvonalban ennyi ideig és legfeljebb ennyi pont marad. */
const TRAIL_WINDOW_MS = 30 * 60 * 1000;
const TRAIL_MAX_POINTS = 600;
/** A megosztás legfeljebb másodpercenként küld. */
const PUBLISH_INTERVAL_MS = 1000;

/** Saját követés: megosztás nélkül nem küldünk helyadatot, bekapcsolva legfeljebb másodpercenként. */
export function shouldPublishLocation(sharing: boolean, now: number, lastSent: number): boolean {
  return sharing && now - lastSent >= PUBLISH_INTERVAL_MS;
}

/**
 * Új pont a nyomvonalhoz (mindig új tömböt ad vissza). Ha a koordináta megegyezik az utolsóval (álló helyzet,
 * drift-szűrő), csak az időbélyeg frissül, így a nyomvonal nem telik meg azonos pontokkal.
 */
export function appendTrackPoint(points: TrackPoint[] | null | undefined, point: TrackPoint, now: number): TrackPoint[] {
  const list = Array.isArray(points) ? points : [];
  const last = list[list.length - 1];
  let next: TrackPoint[];
  if (last && point.t < last.t) {
    next = list; // elkésett, régebbi mérés: nem tesszük a nyomvonal végére
  } else if (last && last.lat === point.lat && last.lng === point.lng) {
    next = [...list.slice(0, -1), { ...point }];
  } else {
    next = [...list, { ...point }];
  }
  const cutoff = now - TRAIL_WINDOW_MS;
  const trimmed = next.filter((p, i) => p.t >= cutoff || i === next.length - 1);
  return trimmed.length > TRAIL_MAX_POINTS ? trimmed.slice(-TRAIL_MAX_POINTS) : trimmed;
}

/** Előzmények törlése: a saját aktuális pozíció továbbra is látszik. */
export function clearTrackHistory(points: TrackPoint[] | null | undefined): TrackPoint[] {
  return Array.isArray(points) ? points.slice(-1) : [];
}
