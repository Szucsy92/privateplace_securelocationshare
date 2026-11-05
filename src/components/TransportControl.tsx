import { useEffect, useRef, useState } from "react";
import { Bike, Car, Footprints } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TransportMode } from "@/lib/transport";
const icons = { walk: Footprints, bike: Bike, car: Car };
const names = { walk: "Gyalogos", bike: "Kerékpár / roller", car: "Autó" };
export const TRANSPORT_DEMO_EVENT = "privateplace:transport-demo";
/** Zárva: egy kerek kör az aktuális ikonnal. Nyitva: csak a 3 ikon. A kijelölt (kézi) újra koppintása visszaállítja az automatikus módot. */
export function TransportControl({ mode, own, manual, onSelect }: { mode: TransportMode | null; own: boolean; manual: boolean; onSelect: (mode: TransportMode | null) => void }) {
  const [open, setOpen] = useState(false);
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setDemo(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(TRANSPORT_DEMO_EVENT, on);
    return () => window.removeEventListener(TRANSPORT_DEMO_EVENT, on);
  }, []);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);
  const current = mode ?? "walk";
  const Icon = icons[current];
  const expanded = (open && own) || demo;
  return <div ref={rootRef} className="map-overlay glass transport-control absolute bottom-4 left-3" data-open={expanded}>
    {!expanded
      ? <Button variant="ghost" size="icon" className="rounded-full shrink-0" aria-label={own ? `Közlekedés: ${names[current]}` : `Követett személy: ${mode ? names[mode] : "ismeretlen közlekedés"}`} aria-expanded={false} onClick={() => own && setOpen(true)}><Icon /></Button>
      : (Object.keys(icons) as TransportMode[]).map(value => { const Choice = icons[value]; return <Button key={value} variant="ghost" size="icon" className="rounded-full shrink-0" aria-label={names[value]} title={names[value]} aria-pressed={current === value} onClick={() => { onSelect(manual && current === value ? null : value); setOpen(false); }}><Choice /></Button>; })}
  </div>;
}
