export type AddressInfo = { title: string; near: string | null };

const str = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Only called after the user explicitly taps the bubble to look up the selected coordinates with OSM's address service. */
export async function lookupAddress(lat: number, lng: number, signal: AbortSignal): Promise<AddressInfo> {
  const base = { format: "jsonv2", lat: String(lat), lon: String(lng), zoom: "18", "accept-language": "hu" };
  const request = async (extra: Record<string, string>): Promise<unknown> => {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({ ...base, ...extra })}`, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  let data: unknown;
  try {
    data = await request({ addressdetails: "1", extratags: "1" });
  } catch (e) {
    if (signal.aborted) throw e;
    data = await request({}); // egyszerű kérés tartaléknak
  }
  if (!data || typeof data !== "object" || !("address" in data)) throw new Error("nincs találat");
  const root = data as { address: unknown; type?: unknown; extratags?: unknown; name?: unknown };
  if (!root.address || typeof root.address !== "object") throw new Error("nincs találat");
  const a = root.address as Record<string, unknown>;
  const extra = root.extratags && typeof root.extratags === "object" ? (root.extratags as Record<string, unknown>) : {};

  // Út neve: autópályánál / főútnál a számjel (pl. M5), különben az utca.
  const ref = str(extra["ref"], 40)?.split(";")[0]?.trim() ?? null;
  const kind = typeof root.type === "string" ? root.type : "";
  const isMotorway = kind === "motorway" || kind === "motorway_link";
  const isMajor = isMotorway || kind === "trunk" || kind === "trunk_link" || kind === "primary";
  const road = str(a["road"]) ?? str(a["pedestrian"]) ?? str(a["footway"]) ?? str(a["neighbourhood"]) ?? str(root.name) ?? str(a["village"]);
  let title = road;
  if (isMajor && ref) {
    if (isMotorway) title = /autópálya/i.test(road ?? "") && road ? road : `${ref} autópálya`;
    else if (/^\d+$/.test(ref)) title = `${ref}. sz. főút`;
    else title = ref;
  }
  if (!title) throw new Error("nincs útnév");
  const number = str(a["house_number"], 20);
  if (number && !isMajor) title = `${title} ${number}`;

  // Közeli település / helynév.
  const place = str(a["city"]) ?? str(a["town"]) ?? str(a["village"]) ?? str(a["hamlet"]) ?? str(a["municipality"]) ?? str(a["suburb"]) ?? str(a["county"]);
  const near = place && !title.includes(place) ? `${place} közelében` : null;
  return { title, near };
}
