/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, darkMapStyle } from "@/lib/googleMaps";
import { circularAvatarIcon } from "@/lib/avatarMarker";
import { animationDurationMs, bearingDegrees, lerpPoint } from "@/lib/mapMath";

export type TrackPoint = { lat: number; lng: number; t: number };

export type MapPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  points: TrackPoint[];
};

export type Orientation = "north" | "heading";

type Props = {
  people: MapPerson[];
  focus: { id: string; request: number } | null;
  showTrails: boolean;
  followId: string | null;
  orientation: Orientation;
  onUserPan?: () => void;
};

type AnimState = {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  start: number;
  duration: number;
};

export default function LiveMap({ people, focus, showTrails, followId, orientation, onUserPan }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const linesRef = useRef<Map<string, google.maps.Polyline>>(new Map());
  const animsRef = useRef<Map<string, AnimState>>(new Map());
  const rafRef = useRef<number | null>(null);
  const didFitRef = useRef(false);
  const followRef = useRef<string | null>(followId);
  const onUserPanRef = useRef(onUserPan);
  followRef.current = followId;
  onUserPanRef.current = onUserPan;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mapHeading, setMapHeading] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        const map = new maps.Map(containerRef.current, {
          center: { lat: 47.4979, lng: 19.0402 },
          zoom: 12,
          disableDefaultUI: true,
          clickableIcons: false,
          zoomControl: true,
          gestureHandling: "greedy",
          styles: darkMapStyle,
        });
        map.addListener("dragstart", () => onUserPanRef.current?.());
        mapRef.current = map;
        setReady(true);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Folyamatos jelölőmozgás: a GPS-pontok között interpolálunk.
  const stepAnimation = () => {
    const map = mapRef.current;
    const now = performance.now();
    let active = false;
    for (const [id, anim] of animsRef.current) {
      const marker = markersRef.current.get(id);
      if (!marker) {
        animsRef.current.delete(id);
        continue;
      }
      const k = Math.min(1, (now - anim.start) / anim.duration);
      const pos = lerpPoint(anim.from, anim.to, k);
      marker.setPosition(pos);
      if (map && followRef.current === id) map.setCenter(pos);
      if (k < 1) {
        active = true;
      } else {
        animsRef.current.delete(id);
      }
    }
    rafRef.current = active ? requestAnimationFrame(stepAnimation) : null;
  };

  const ensureAnimationLoop = () => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(stepAnimation);
  };

  // Jelölők és nyomvonalak frissítése
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    const alive = new Set(people.map((p) => p.id));
    for (const [id, marker] of markersRef.current) {
      if (!alive.has(id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
        animsRef.current.delete(id);
      }
    }
    for (const [id, line] of linesRef.current) {
      if (!alive.has(id) || !showTrails) {
        line.setMap(null);
        linesRef.current.delete(id);
      }
    }

    (async () => {
      for (const person of people) {
        const last = person.points[person.points.length - 1];
        if (!last) continue;
        const pos = { lat: last.lat, lng: last.lng };

        let marker = markersRef.current.get(person.id);
        if (!marker) {
          const icon = await circularAvatarIcon(person.avatarUrl, person.name, person.color);
          if (cancelled) return;
          marker = new google.maps.Marker({
            map,
            position: pos,
            title: person.name,
            icon: {
              url: icon,
              scaledSize: new google.maps.Size(48, 48),
              anchor: new google.maps.Point(24, 24),
            },
            optimized: false,
            zIndex: 10,
          });
          markersRef.current.set(person.id, marker);
        } else {
          const current = marker.getPosition();
          const from = current ? { lat: current.lat(), lng: current.lng() } : pos;
          if (Math.abs(from.lat - pos.lat) > 1e-9 || Math.abs(from.lng - pos.lng) > 1e-9) {
            const prev = person.points[person.points.length - 2];
            animsRef.current.set(person.id, {
              from,
              to: pos,
              start: performance.now(),
              duration: animationDurationMs(prev?.t ?? null, last.t),
            });
            ensureAnimationLoop();
          }
        }

        if (showTrails && person.points.length > 1) {
          const path = person.points.map((p) => ({ lat: p.lat, lng: p.lng }));
          let line = linesRef.current.get(person.id);
          if (!line) {
            line = new google.maps.Polyline({
              map,
              path,
              strokeColor: person.color,
              strokeOpacity: 0.85,
              strokeWeight: 4,
            });
            linesRef.current.set(person.id, line);
          } else {
            line.setPath(path);
          }
        }
      }

      if (!didFitRef.current && people.some((p) => p.points.length)) {
        const bounds = new google.maps.LatLngBounds();
        people.forEach((p) => {
          const last = p.points[p.points.length - 1];
          if (last) bounds.extend({ lat: last.lat, lng: last.lng });
        });
        map.fitBounds(bounds, 80);
        if (people.length === 1) map.setZoom(16);
        didFitRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [people, ready, showTrails]);

  // Kiválasztott személy középre
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;
    const person = people.find((p) => p.id === focus.id);
    const last = person?.points[person.points.length - 1];
    if (!last) return;
    map.panTo({ lat: last.lat, lng: last.lng });
    if ((map.getZoom() ?? 0) < 15) map.setZoom(16);
  }, [focus, ready]);

  // A követett személy haladási iránya (az utolsó szakasz alapján)
  useEffect(() => {
    if (orientation !== "heading" || !followId) {
      setMapHeading(0);
      return;
    }
    const person = people.find((p) => p.id === followId);
    const pts = person?.points ?? [];
    if (pts.length < 2) return;
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    setMapHeading(bearingDegrees(a, b));
  }, [people, followId, orientation]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  const rotated = orientation === "heading" && followId != null;
  return (
    <div className="h-full w-full overflow-hidden">
      <div
        ref={containerRef}
        className="h-full w-full transition-transform duration-700 ease-linear"
        style={rotated ? { transform: `rotate(${-mapHeading}deg) scale(1.5)` } : undefined}
        aria-label="Élő térkép"
      />
    </div>
  );
}
