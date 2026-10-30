/** Only called after the user explicitly permits sharing the selected coordinates with OSM's address service. */
export async function lookupAddress(lat: number, lng: number, signal: AbortSignal): Promise<string | null> {
  const params = new URLSearchParams({ format: "jsonv2", lat: String(lat), lon: String(lng), zoom: "18", "accept-language": "hu" });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, { signal });
  if (!response.ok) return null;
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("address" in data)) return null;
  const address = (data as { address: unknown }).address;
  if (!address || typeof address !== "object") return null;
  const values = address as Record<string, unknown>;
  const road = values["road"] ?? values["pedestrian"] ?? values["footway"] ?? values["neighbourhood"] ?? values["village"];
  if (typeof road !== "string") return null;
  const number = values["house_number"];
  return `${road.slice(0, 120)}${typeof number === "string" ? ` ${number.slice(0, 20)}` : ""}`;
}