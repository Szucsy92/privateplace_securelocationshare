import { useEffect, useRef, useState } from "react";
import { Battery, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { distanceMeters } from "@/lib/mapMath";
import { stopLabel } from "@/lib/stationary";
import { lookupAddress } from "@/lib/address";
import type { MapPerson } from "./LiveMap";
export function PersonBubble({ person, self, addressAllowed, onAllow }: { person: MapPerson; self: MapPerson | undefined; addressAllowed: boolean; onAllow: () => void }) {
  const [address, setAddress] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const lastQuery = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  const last = person.points.at(-1);
  const own = self?.points.at(-1);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!addressAllowed || !last) return;
    const prev = lastQuery.current;
    if (prev && (Date.now() - prev.at < 15000 || distanceMeters(prev, last) < 25)) return;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    lastQuery.current = { ...last, at: Date.now() };
    void lookupAddress(last.lat, last.lng, controller.signal).then(setAddress).catch(() => {});
  }, [addressAllowed, last?.lat, last?.lng, clock]);
  const distance = own && last ? distanceMeters(own, last) : null;
  return <div className="person-bubble glass" role="status" aria-label={`${person.name} adatai`}>
    <div className="flex items-center justify-center gap-1 text-[11px]"><Battery className="h-3 w-3" />{person.battery == null ? "–" : `${person.battery}%`}<span>·</span>{distance === null ? "–" : distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1).replace(".", ",")} km`}</div>
    {addressAllowed ? <div className="bubble-address text-xs font-semibold">{address ?? "Cím nem elérhető"}</div> : <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onAllow}><MapPin className="h-3 w-3" />Cím lekérése</Button>}
    <div className="text-[11px] text-muted-foreground">{stopLabel(person.stoppedSince, clock)}</div>
  </div>;
}