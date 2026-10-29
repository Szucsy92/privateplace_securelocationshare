import { useState } from "react";
import { Bike, Car, Footprints, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TransportMode } from "@/lib/transport";
const icons = { walk: Footprints, bike: Bike, car: Car };
const names = { walk: "Gyalogos", bike: "Kerékpár / roller", car: "Autó" };
export function TransportControl({ mode, own, manual, onSelect }: { mode: TransportMode | null; own: boolean; manual: boolean; onSelect: (mode: TransportMode | null) => void }) {
  const [open, setOpen] = useState(false);
  const Icon = icons[mode ?? "walk"];
  return <div className="map-overlay glass transport-control absolute bottom-4 left-3" data-open={open && own}>
    <Button variant="ghost" size="icon" className="rounded-full shrink-0" aria-label={own ? `Közlekedés: ${names[mode ?? "walk"]}` : `Követett személy: ${mode ? names[mode] : "ismeretlen közlekedés"}`} aria-expanded={open && own} onClick={() => own && setOpen(v => !v)}><Icon /></Button>
    {own && open && <div className="flex gap-1 transport-options">
      {(Object.keys(icons) as TransportMode[]).map(value => { const Choice = icons[value]; return <Button key={value} variant="ghost" size="icon" className="rounded-full" aria-label={names[value]} title={names[value]} aria-pressed={mode === value} onClick={() => { onSelect(value); setOpen(false); }}><Choice /></Button>; })}
      <Button variant="ghost" size="icon" className="rounded-full" aria-label="Automatikus közlekedési mód" title="Automatikus" aria-pressed={!manual} onClick={() => { onSelect(null); setOpen(false); }}><RotateCcw /></Button>
    </div>}
  </div>;
}