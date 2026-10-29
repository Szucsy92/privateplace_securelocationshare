import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
export type SharingStatus = "off" | "live" | "search" | "lost";
export const STATUS_EXPANSION_MS = 3000;
export function SharingControl({ status, onToggle }: { status: SharingStatus; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(true);
    const timer = setTimeout(() => setExpanded(false), STATUS_EXPANSION_MS);
    return () => clearTimeout(timer);
  }, [status]);
  const label = { off: "Megosztás ki", live: "Megosztás be", search: "Helyzet keresése…", lost: "Nincs jel" }[status];
  return <Button variant="ghost" className="sharing-control glass" data-status={status} data-expanded={expanded} aria-label={status === "off" ? "Megosztás indítása" : "Megosztás leállítása"} aria-pressed={status !== "off"} onClick={onToggle}>
    {status === "off" ? <Play /> : <Pause />}<span className="sharing-label" aria-hidden={!expanded}>{label}</span>
  </Button>;
}