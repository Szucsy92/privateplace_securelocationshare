import { useEffect, useRef, useState, type RefObject } from "react";
import type { Map as MlMap, Marker as MlMarker, GeoJSONSource } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { animationDurationMs, headingFromTrack, lerpPoint, smoothAngle } from "@/lib/mapMath";

export type TrackPoint = { lat: number; lng: number; t: number };

export type MapPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  points: TrackPoint[];
  isSelf?: boolean;
};

export type Orientation = "north" | "heading";

/** Független, kulcs nélküli nyílt térképstílus (OpenStreetMap adatok, OpenFreeMap csempék). */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
/** Kellemes rálátás: a környező utcák is látszanak. */
const FOCUS_ZOOM = 15.6;

type Props = {
  people: MapPerson[];
  follow: { id: string; request: number } | null;
  showTrails: boolean;
  orientation: Orientation;
  onUserPan: () => void;
  compassRef?: RefObject<HTMLElement | null>;
};

type MarkerState = {
  marker: MlMarker;
  el: HTMLDivElement;
  pos: { lat: number; lng: number };
  key: string;
  anim: { from: { lat: number; lng: number }; to: { lat: number; lng: number }; start: number; duration: number } | null;
};

function fillAvatar(el: HTMLDivElement, person: MapPerson) {
  el.style.setProperty("--person-color", person.color);
  el.classList.toggle("is-self", Boolean(person.isSelf));
  el.replaceChildren();
  if (person.avatarUrl) {
    const img = document.createElement("img");
    img.src = person.avatarUrl;
    img.alt = "";
    img.draggable = false;
    el.appendChild(img);
  } else {
    const span = document.createElement("span");
    span.textContent = (person.name || "?").charAt(0).toUpperCase();
    el.appendChild(span);
  }
  el.title = person.name;
}

export default function LiveMap({ people, follow, showTrails, orientation, onUserPan, compassRef }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerCtorRef = useRef<typeof MlMarker | null>(null);
  const markersRef = useRef(new Map<string, MarkerState>());
  const headingsRef = useRef(new Map<string, number>());
  const flyingRef = useRef(false);
  const didCenterRef = useRef(false);
  const propsRef = useRef({ follow, orientation, onUserPan });
  propsRef.current = { follow, orientation, onUserPan };
  const compassElRef = useRef(compassRef);
  compassElRef.current = compassRef;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let map: MlMap | null = null;

    const step = () => {
      raf = requestAnimationFrame(step);
      const m = mapRef.current;
      if (!m) return;
      const now = performance.now();
      for (const s of markersRef.current.values()) {
        if (!s.anim) continue;
        const k = Math.min(1, (now - s.anim.start) / s.anim.duration);
        s.pos = lerpPoint(s.anim.from, s.anim.to, k);
        s.marker.setLngLat([s.pos.lng, s.pos.lat]);
        if (k >= 1) s.anim = null;
      }
      if (flyingRef.current || m.isZooming()) return;
      const { follow: f, orientation: o } = propsRef.current;
      const bearing = m.getBearing();
      if (f) {
        const s = markersRef.current.get(f.id);
        if (!s) return;
        const target = o === "heading" ? (headingsRef.current.get(f.id) ?? bearing) : 0;
        const nb = Math.abs(target - bearing) < 0.05 ? target : smoothAngle(bearing, target, 0.07);
        const c = m.getCenter();
        if (Math.abs(c.lat - s.pos.lat) > 1e-8 || Math.abs(c.lng - s.pos.lng) > 1e-8 || nb !== bearing) {
          m.jumpTo({ center: [s.pos.lng, s.pos.lat], bearing: nb });
        }
      } else if (o === "north" && Math.abs(bearing) > 0.05) {
        m.jumpTo({ bearing: smoothAngle(bearing, 0, 0.12) });
      }
    };

    void (async () => {
      try {
        const lib = await import("maplibre-gl");
        if (cancelled || !containerRef.current) return;
        lib.setWorkerUrl(workerUrl);
        markerCtorRef.current = lib.Marker;
        map = new lib.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: [19.0402, 47.4979],
          zoom: 12,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        map.on("dragstart", () => propsRef.current.onUserPan());
        map.on("moveend", () => {
          flyingRef.current = false;
        });
        map.on("rotate", () => {
          const el = compassElRef.current?.current;
          if (el && map) el.style.transform = `rotate(${-map.getBearing()}deg)`;
        });
        map.on("error", (e) => {
          if (!mapRef.current?.loaded()) console.warn("Térkép hiba", e.error);
        });
        map.on("load", () => {
          if (!map) return;
          map.addSource("trails", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({
            id: "trails",
            type: "line",
            source: "trails",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.85, "line-blur": 0.5 },
          });
          setReady(true);
        });
        mapRef.current = map;
        raf = requestAnimationFrame(step);
      } catch {
        setError("A térképet nem sikerült betölteni. Ellenőrizd az internetkapcsolatot.");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      markersRef.current.forEach((s) => s.marker.remove());
      markersRef.current.clear();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Jelölők, irányok, nyomvonalak
  useEffect(() => {
    const map = mapRef.current;
    const Marker = markerCtorRef.current;
    if (!map || !Marker || !ready) return;

    const alive = new Set(people.map((p) => p.id));
    for (const [id, s] of markersRef.current) {
      if (!alive.has(id)) {
        s.marker.remove();
        markersRef.current.delete(id);
        headingsRef.current.delete(id);
      }
    }

    for (const person of people) {
      const last = person.points[person.points.length - 1];
      if (!last) continue;
      const pos = { lat: last.lat, lng: last.lng };
      const key = `${person.avatarUrl ?? ""}|${person.name}|${person.color}`;
      const heading = headingFromTrack(person.points);
      if (heading != null) headingsRef.current.set(person.id, heading);

      let s = markersRef.current.get(person.id);
      if (!s) {
        const el = document.createElement("div");
        el.className = "map-avatar";
        fillAvatar(el, person);
        const marker = new Marker({ element: el, anchor: "center" }).setLngLat([pos.lng, pos.lat]).addTo(map);
        s = { marker, el, pos, key, anim: null };
        markersRef.current.set(person.id, s);
      } else {
        if (s.key !== key) {
          fillAvatar(s.el, person);
          s.key = key;
        }
        const target = s.anim?.to ?? s.pos;
        if (Math.abs(target.lat - pos.lat) > 1e-9 || Math.abs(target.lng - pos.lng) > 1e-9) {
          const prev = person.points[person.points.length - 2];
          s.anim = {
            from: { ...s.pos },
            to: pos,
            start: performance.now(),
            duration: animationDurationMs(prev?.t ?? null, last.t),
          };
        }
      }
    }

    const source = map.getSource("trails") as GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: showTrails
        ? people
            .filter((p) => p.points.length > 1)
            .map((p) => ({
              type: "Feature" as const,
              properties: { color: p.color },
              geometry: { type: "LineString" as const, coordinates: p.points.map((pt) => [pt.lng, pt.lat]) },
            }))
        : [],
    });

    if (!didCenterRef.current) {
      const self = people.find((p) => p.isSelf && p.points.length);
      const last = self?.points[self.points.length - 1];
      if (last) {
        didCenterRef.current = true;
        flyingRef.current = true;
        map.flyTo({ center: [last.lng, last.lat], zoom: FOCUS_ZOOM, duration: 1600, essential: true });
      }
    }
  }, [people, ready, showTrails]);

  // Odaugrás: minden újabb kérésre lágy kameramozgással középre áll.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !follow) return;
    const s = markersRef.current.get(follow.id);
    if (!s) return;
    const zoom = map.getZoom();
    flyingRef.current = true;
    map.flyTo({
      center: [s.pos.lng, s.pos.lat],
      zoom: zoom < 14.5 || zoom > 18 ? FOCUS_ZOOM : zoom,
      bearing: orientation === "heading" ? (headingsRef.current.get(follow.id) ?? map.getBearing()) : 0,
      duration: 1400,
      curve: 1.3,
      essential: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow?.request, ready]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" aria-label="Élő térkép" />;
}
