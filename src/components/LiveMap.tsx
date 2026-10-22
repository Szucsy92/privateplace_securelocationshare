/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, darkMapStyle } from "@/lib/googleMaps";
import { circularAvatarIcon } from "@/lib/avatarMarker";

export type TrackPoint = { lat: number; lng: number; t: number };

export type MapPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  points: TrackPoint[];
};

type Props = {
  people: MapPerson[];
  focus: { id: string; request: number } | null;
  showTrails: boolean;
};

export default function LiveMap({ people, focus, showTrails }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const linesRef = useRef<Map<string, google.maps.Polyline>>(new Map());
  const didFitRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        mapRef.current = new maps.Map(containerRef.current, {
          center: { lat: 47.4979, lng: 19.0402 },
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          styles: darkMapStyle,
        });
        setReady(true);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

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
          marker.setPosition(pos);
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

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" aria-label="Élő térkép" />;
}
