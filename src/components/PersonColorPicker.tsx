import { Check } from "lucide-react";
import { PERSON_COLOR_OPTIONS } from "@/lib/personColors";

/** Matt üveg színválasztó a jelölők színéhez: körök a felajánlott színekkel, és „Alap” gomb az eredeti szín visszaállításához. */
export function PersonColorPicker({ value, custom, onChange }: { value: string; custom: boolean; onChange: (color: string | null) => void }) {
  return (
    <div className="glass-inset mt-2 flex flex-wrap items-center gap-2 rounded-2xl p-2.5" role="group" aria-label="Jelölőszín">
      {PERSON_COLOR_OPTIONS.map((c) => {
        const active = c.value.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={active}
            aria-label={c.name}
            title={c.name}
            onClick={() => onChange(c.value)}
            className="grid h-8 w-8 place-items-center rounded-full border border-[var(--glass-edge)] transition-transform active:scale-90"
            style={{ background: c.value, boxShadow: active ? "0 0 0 2px var(--ring)" : "none" }}
          >
            {active && <Check className="h-4 w-4 text-black/70" />}
          </button>
        );
      })}
      {custom && (
        <button type="button" onClick={() => onChange(null)} className="glass-button ml-auto h-8 rounded-full border px-3 text-xs">
          Alap
        </button>
      )}
    </div>
  );
}
