import { useEffect, useRef, useState, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PersonBubble } from "./PersonBubble";
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
  heading?: number | null;
  battery?: number | null;
  stoppedSince?: number | null;
  speed?: number | null;
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
  trailIds?: string[];
  orientation: Orientation;
  theme: "dark" | "light";
  onUserPan: () => void;
  compassRef?: RefObject<HTMLElement | null>;
  addressAllowed: boolean;
  onAllowAddress: () => void;
  /** Az éles térképablak távolsága a képernyő széleitől: a középpont és a ráközelítés ehhez igazodik. */
  padding?: MapPadding;
  /** Kis tükör-canvas: minden renderelt képkockát ide másolunk, a MapApp ezt mossa el a térképablakon kívül. */
  mirrorRef?: RefObject<HTMLCanvasElement | null>;
};

export type MapPadding = { top: number; right: number; bottom: number; left: number };

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
  const arrow = document.createElement("i");
  arrow.className = "heading-arrow";
  el.appendChild(arrow);
  el.title = person.name;
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", `${person.name} adatai`);
}

/** Térképfeliratok: a betűméret szorzója (1.25 = +25%) és a kontúr vastagsága képpontban. Itt állítható. */
const LABEL_SCALE = 1.25;
const LABEL_HALO_WIDTH = 2;

/** Az alapstílus eredeti betűméretei: a témaváltáskor nem szabad újra megszorozni az már megnagyított értéket. */
const baseTextSize = new Map<string, unknown>();

/** Szám, interpolate, step vagy régi stops formátumú betűméret skálázása; ismeretlen kifejezéshez nem nyúl. */
function scaleTextSize(size: unknown, k: number): unknown {
  if (typeof size === "number") return size * k;
  if (Array.isArray(size)) {
    const op = size[0];
    if (op === "interpolate" || op === "interpolate-hcl" || op === "interpolate-lab")
      return size.map((x, i) => (i >= 4 && i % 2 === 0 ? scaleTextSize(x, k) : x));
    if (op === "step") return size.map((x, i) => (i >= 2 && i % 2 === 0 ? scaleTextSize(x, k) : x));
    return size;
  }
  if (size && typeof size === "object" && Array.isArray((size as { stops?: unknown }).stops)) {
    const f = size as { stops: [number, unknown][] };
    return { ...f, stops: f.stops.map(([z, v]) => [z, scaleTextSize(v, k)]) };
  }
  return size;
}

function applyMapContrast(map: MlMap, theme: "dark" | "light") {
  const css = getComputedStyle(document.documentElement);
  const color = (role: string) => css.getPropertyValue(`--map-${theme}-${role}`).trim();
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id;
    if (layer.type === "background") map.setPaintProperty(id, "background-color", color("background"));
    if (layer.type === "fill") {
      if (id === "water") map.setPaintProperty(id, "fill-color", color("water"));
      if (id === "building") {
        map.setPaintProperty(id, "fill-color", color("building"));
        map.setPaintProperty(id, "fill-outline-color", color("building-edge"));
        map.setPaintProperty(id, "fill-opacity", 1);
      }
      if (id === "landuse_park" || id === "landcover_wood") map.setPaintProperty(id, "fill-color", color("park"));
    }
    if (layer.type === "line" && (id.startsWith("highway_") || id.startsWith("road_"))) {
      map.setPaintProperty(id, "line-color", color(id.includes("casing") ? "road-casing" : id.includes("major") || id.includes("motorway") ? "road-major" : "road"));
      map.setPaintProperty(id, "line-opacity", 1);
    }
    if (layer.type === "symbol" && layer.layout?.["text-field"]) {
      map.setPaintProperty(id, "text-color", color("label"));
      map.setPaintProperty(id, "text-halo-color", color("halo"));
      map.setPaintProperty(id, "text-halo-width", LABEL_HALO_WIDTH);
      if (!baseTextSize.has(id)) baseTextSize.set(id, layer.layout?.["text-size"]);
      const base = baseTextSize.get(id);
      if (base !== undefined) map.setLayoutProperty(id, "text-size", scaleTextSize(base, LABEL_SCALE) as never);
    }
  }
}

export default function LiveMap({ people, follow, showTrails, trailIds, orientation, theme, onUserPan, compassRef, addressAllowed, onAllowAddress, padding, mirrorRef }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerCtorRef = useRef<typeof MlMarker | null>(null);
  const markersRef = useRef(new Map<string, MarkerState>());
  const headingsRef = useRef(new Map<string, number>());
  const flyingRef = useRef(false);
  const didCenterRef = useRef(false);
  const propsRef = useRef({ follow, orientation, onUserPan, padding, mirrorRef });
  propsRef.current = { follow, orientation, onUserPan, padding, mirrorRef };
  const compassElRef = useRef(compassRef);
  compassElRef.current = compassRef;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const bubbleRef = useRef<{ marker: MlMarker; el: HTMLDivElement; root: Root } | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

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
      for (const [id, s] of markersRef.current) {
        const arrow = s.el.querySelector<HTMLElement>(".heading-arrow");
        const heading = headingsRef.current.get(id);
        if (arrow) {
          arrow.hidden = propsRef.current.orientation !== "heading" || heading === undefined;
          arrow.style.transform = `rotate(${(heading ?? 0) - m.getBearing()}deg)`;
        }
      }
      const bubble = bubbleRef.current;
      const personMarker = selectedRef.current ? markersRef.current.get(selectedRef.current) : null;
      if (bubble && personMarker) {
        bubble.marker.setLngLat([personMarker.pos.lng, personMarker.pos.lat]);
        const point = m.project([personMarker.pos.lng, personMarker.pos.lat]);
        const width = bubble.el.getBoundingClientRect().width;
        const available = m.getContainer().clientWidth;
        const pad = propsRef.current.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
        const minX = pad.left + 8 + width / 2;
        const maxX = available - pad.right - 8 - width / 2;
        const offset = Math.max(minX, Math.min(maxX, point.x)) - point.x;
        bubble.marker.setOffset([offset, point.y < pad.top + 110 ? 32 + bubble.el.getBoundingClientRect().height : -32]);
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
        if (propsRef.current.padding) map.setPadding(propsRef.current.padding);
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        // A WebGL-vászon alatt a backdrop-filter nem mos megbízhatóan (WebKit/WebView), ezért minden kép után
        // lekicsinyítve átmásoljuk egy 2D-canvasra, amit sima CSS filter mos el (lásd .map-mirror).
        // A másolásnak a render eseményben kell történnie, amíg a képkocka még érvényes.
        const MIRROR_PAD = 24;
        const MIRROR_STEP = 3;
        map.on("render", () => {
          const dst = propsRef.current.mirrorRef?.current;
          const src = map?.getCanvas();
          if (!dst || !src || !src.width || !src.clientWidth) return;
          const w = Math.max(1, Math.round((src.clientWidth + MIRROR_PAD * 2) / MIRROR_STEP));
          const h = Math.max(1, Math.round((src.clientHeight + MIRROR_PAD * 2) / MIRROR_STEP));
          if (dst.width !== w || dst.height !== h) { dst.width = w; dst.height = h; }
          const ctx = dst.getContext("2d");
          if (!ctx) return;
          const p = MIRROR_PAD / MIRROR_STEP;
          ctx.drawImage(src, 0, 0, w, h);
          ctx.drawImage(src, p, p, w - p * 2, h - p * 2);
        });
        map.on("dragstart", () => propsRef.current.onUserPan());
        map.on("click", () => setSelected(null));
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
          containerRef.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
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
      bubbleRef.current?.root.unmount();
      bubbleRef.current?.marker.remove();
      bubbleRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) applyMapContrast(map, theme);
  }, [ready, theme]);

  // Az éles térképablak helye: a térkép középpontja az ablak közepe marad.
  useEffect(() => {
    const map = mapRef.current;
    if (map && padding) map.setPadding(padding);
  }, [padding?.top, padding?.right, padding?.bottom, padding?.left, ready]);

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
      const heading = person.heading ?? headingFromTrack(person.points);
      if (heading != null) headingsRef.current.set(person.id, heading);

      let s = markersRef.current.get(person.id);
      if (!s) {
        const el = document.createElement("div");
        el.className = "map-avatar";
        fillAvatar(el, person);
        const toggle = (event: Event) => { event.stopPropagation(); setSelected(current => current === person.id ? null : person.id); };
        el.addEventListener("click", toggle);
        el.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(event); } });
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
      features: showTrails || (trailIds && trailIds.length)
        ? people
            .filter((p) => (showTrails || trailIds?.includes(p.id)) && p.points.length > 1)
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
  }, [people, ready, showTrails, trailIds]);

  useEffect(() => {
    const map = mapRef.current;
    const Marker = markerCtorRef.current;
    const person = people.find(p => p.id === selected);
    const pos = selected ? markersRef.current.get(selected)?.pos : null;
    if (!map || !Marker || !person || !pos || !ready) {
      bubbleRef.current?.root.unmount(); bubbleRef.current?.marker.remove(); bubbleRef.current = null;
      return;
    }
    if (!bubbleRef.current) {
      const el = document.createElement("div");
      el.className = "person-bubble-anchor";
      el.addEventListener("click", event => event.stopPropagation());
      const marker = new Marker({ element: el, anchor: "bottom", offset: [0, -32] }).setLngLat([pos.lng, pos.lat]).addTo(map);
      bubbleRef.current = { marker, el, root: createRoot(el) };
    }
    bubbleRef.current.root.render(<PersonBubble key={person.id} person={person} self={people.find(p => p.isSelf)} addressAllowed={addressAllowed} onAllow={onAllowAddress} />);
  }, [selected, people, ready, addressAllowed, onAllowAddress]);

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
