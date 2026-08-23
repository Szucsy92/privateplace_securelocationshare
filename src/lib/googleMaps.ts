/// <reference types="google.maps" />

let loaderPromise: Promise<typeof google.maps> | null = null;

/**
 * Betölti a Google Maps JS API-t (aszinkron, callback-kel), egyszer.
 * Csak böngészőben hívható.
 */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("A térkép csak böngészőben tölthető be"));
  }
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>;
    if (w["google"] && (w["google"] as typeof google).maps?.Map) {
      resolve((w["google"] as typeof google).maps);
      return;
    }

    const key = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"];
    const channel = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"] ?? "";
    if (!key) {
      reject(new Error("Hiányzik a Google Maps böngésző kulcs"));
      return;
    }

    const callbackName = "__initGoogleMapsLive";
    w[callbackName] = () => {
      resolve((window as unknown as { google: typeof google }).google.maps);
    };

    const script = document.createElement("script");
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(String(key))}` +
      `&loading=async&callback=${callbackName}&language=hu&region=HU` +
      (channel ? `&channel=${encodeURIComponent(String(channel))}` : "");
    script.async = true;
    script.onerror = () => reject(new Error("Nem sikerült betölteni a Google Maps-et"));
    document.head.appendChild(script);
  });

  return loaderPromise;
}

/** Sötét térkép stílus, hogy illeszkedjen a felülethez. */
export const darkMapStyle: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1b2130" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1b2130" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8f9bb3" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a3244" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9aa7bf" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3a4considered" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#131a26" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#39435a" }] },
];
