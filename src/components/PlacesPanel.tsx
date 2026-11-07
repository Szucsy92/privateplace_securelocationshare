import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MapPin, Plus, Trash2, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ElasticScroll } from "@/components/ElasticScroll";
import { MAX_RADIUS, MIN_RADIUS, describeVector, learnBias, medianPoint, newPlace, newSpot, nudgeSpot, offsetPoint, type FixLite, type Place, type Spot } from "@/lib/places";

type Props = {
  places: Place[];
  onChange: (places: Place[]) => void;
  /** A legutóbbi szűrt, de még nem korrigált fixek (a tanuláshoz és az élő eltérés-kijelzéshez). */
  getRecent: () => FixLite[];
  /** Térképes kijelölés: a panel bezárul, a térkép közepén célkereszt jelenik meg. spotId = null → új pont. */
  onPick: (target: { placeId: string; spotId: string | null }) => void;
  openId: string | null;
  onBack: () => void;
};

const STEPS = [0.5, 1, 2, 5];
const REASONS: Record<string, string> = {
  "kevés fix": "Még kevés a mérés, várj néhány másodpercet.",
  pontatlan: "A GPS most túl pontatlan (±15 m fölött), várj egy kicsit.",
  mozgás: "Mozgást érzékeltem: állj meg a ponton, és tartsd nyugodtan a telefont.",
  "nagy eltérés": "Az eltérés 60 m fölött van. Ellenőrizd a kijelölt pontot.",
};

export default function PlacesPanel({ places, onChange, getRecent, onPick, openId, onBack }: Props) {
  const [open, setOpen] = useState<string | null>(openId);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1500); return () => clearInterval(t); }, []);

  const place = open ? places.find((p) => p.id === open) ?? null : null;
  const patchPlace = (fn: (p: Place) => Place) => place && onChange(places.map((p) => (p.id === place.id ? fn(p) : p)));
  const patchSpot = (id: string, fn: (s: Spot) => Spot) => patchPlace((p) => ({ ...p, spots: p.spots.map((s) => (s.id === id ? fn(s) : s)) }));
  const here = () => medianPoint(getRecent());

  const addPlace = () => {
    const p = newPlace(draft ?? "");
    onChange([...places, p]);
    setDraft(null);
    setOpen(p.id);
  };

  if (!place) {
    return (
      <>
        <DialogHeader className="shrink-0 flex-row items-center space-y-0 gap-1 p-3 pb-2 pr-12 text-left">
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" aria-label="Vissza" onClick={onBack}><ChevronLeft className="h-5 w-5" /></Button>
          <DialogTitle className="font-display text-base">Saját helyek</DialogTitle>
          <DialogDescription className="sr-only">Helyek hozzáadása, pontosítása, módosítása és törlése.</DialogDescription>
        </DialogHeader>
        <ElasticScroll className="px-4 pb-4 pt-4">
          <div className="space-y-2.5">
            <p className="text-xs text-muted-foreground">Add meg, hol vagy valójában egy helyen belül, és az app megtanulja, mennyit téved ott a telefon. Az adatok csak ezen a telefonon maradnak.</p>
            {places.map((p) => {
              const learned = p.spots.filter((s) => s.bias).length;
              return (
                <button key={p.id} type="button" className="glass-inset flex w-full items-center gap-3 rounded-2xl p-3 text-left" onClick={() => setOpen(p.id)}>
                  <span className="w-6 text-center text-lg">{p.icon || <MapPin className="mx-auto h-4 w-4" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{p.spots.length} pont · {learned} tanult</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0" />
                </button>
              );
            })}
            {draft === null ? (
              <Button size="sm" variant="outline" className="glass-button w-full rounded-full" onClick={() => setDraft("")}><Plus className="mr-1.5 h-4 w-4" />Hely hozzáadása</Button>
            ) : (
              <div className="glass-inset space-y-2 rounded-2xl p-3">
                <Input autoFocus value={draft} maxLength={60} placeholder="Hely neve (bármi lehet)" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addPlace(); }} />
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" className="glass-button rounded-full" onClick={() => setDraft(null)}>Mégse</Button>
                  <Button size="sm" className="rounded-full" disabled={!draft.trim()} onClick={addPlace}>Hozzáadás</Button>
                </div>
              </div>
            )}
          </div>
        </ElasticScroll>
      </>
    );
  }

  const learn = (s: Spot) => {
    const r = learnBias(s, getRecent());
    if (!r.ok) { toast.warning(REASONS[r.reason] ?? "Most nem sikerült."); return; }
    patchSpot(s.id, () => r.spot);
    toast.success("Megtanultam ezt a pontot");
  };
  const addSpotHere = () => {
    const h = here();
    if (!h) { toast.warning("Még nincs mérésem. Várj, amíg a GPS fixál."); return; }
    patchPlace((p) => ({ ...p, spots: [...p.spots, newSpot(h, `Pont ${p.spots.length + 1}`)] }));
  };

  return (
    <>
      <DialogHeader className="shrink-0 flex-row items-center space-y-0 gap-1 p-3 pb-2 pr-12 text-left">
        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" aria-label="Vissza a helyekhez" onClick={() => { setOpen(null); setConfirm(null); }}><ChevronLeft className="h-5 w-5" /></Button>
        <DialogTitle className="font-display min-w-0 truncate text-base">{place.icon} {place.name}</DialogTitle>
        <DialogDescription className="sr-only">A hely adatainak és pontjainak szerkesztése.</DialogDescription>
      </DialogHeader>
      <ElasticScroll className="px-4 pb-4 pt-4">
        <div className="space-y-2.5">
          <div className="glass-inset space-y-2 rounded-2xl p-3">
            <div className="grid grid-cols-[4rem_1fr] gap-2">
              <Input value={place.icon} maxLength={8} placeholder="🏠" aria-label="Jel (emoji vagy szöveg)" onChange={(e) => patchPlace((p) => ({ ...p, icon: e.target.value }))} />
              <Input value={place.name} maxLength={60} placeholder="Név" aria-label="Név" onChange={(e) => patchPlace((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <Input value={place.note} maxLength={200} placeholder="Megjegyzés (nem kötelező)" aria-label="Megjegyzés" onChange={(e) => patchPlace((p) => ({ ...p, note: e.target.value }))} />
            <label className="block text-xs text-muted-foreground">
              A korrekció hatóköre: {place.radius.toFixed(0)} m a tanult ponttól
              <input type="range" className="mt-1 w-full" min={MIN_RADIUS} max={MAX_RADIUS} step={1} value={place.radius} onChange={(e) => patchPlace((p) => ({ ...p, radius: Number(e.target.value) }))} />
            </label>
          </div>

          {place.spots.map((s) => {
            const h = here();
            const expected = s.bias ? offsetPoint(s, s.bias.e, s.bias.n) : null;
            return (
              <div key={s.id} className="glass-inset space-y-2 rounded-2xl p-3">
                <div className="flex items-center gap-2">
                  <Input value={s.label} maxLength={60} placeholder="Pont neve (pl. ágy, konyhapult)" aria-label="Pont neve" onChange={(e) => patchSpot(s.id, (x) => ({ ...x, label: e.target.value }))} />
                  <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-full" aria-label="Pont törlése" title="Pont törlése" onClick={() => patchPlace((p) => ({ ...p, spots: p.spots.filter((x) => x.id !== s.id) }))}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {s.bias && expected
                    ? `Tanult: a telefon itt ${describeVector(s, expected)} tér el (${s.samples} mérésből).`
                    : "Még nem tanult. Állj a ponton, és nyomd meg a Tanulást."}
                </p>
                {h && <p className="text-xs text-muted-foreground">A telefon most {describeVector(s, h)} mutat a kijelölt ponttól.</p>}
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" className="glass-button rounded-full" onClick={() => onPick({ placeId: place.id, spotId: s.id })}><Crosshair className="mr-1.5 h-4 w-4" />Kijelölés</Button>
                  <Button size="sm" className="rounded-full" onClick={() => learn(s)}>Itt állok: tanulás</Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Pontosítás</span>
                  <div className="ml-auto flex gap-1">
                    {STEPS.map((v) => (
                      <Button key={v} size="sm" variant={v === step ? "default" : "outline"} className="h-7 rounded-full px-2 text-[11px]" onClick={() => setStep(v)}>{String(v).replace(".", ",")} m</Button>
                    ))}
                  </div>
                </div>
                <div className="mx-auto grid w-40 grid-cols-3 gap-1" aria-label="A kijelölt pont mozgatása">
                  <span />
                  <Button size="icon" variant="outline" className="glass-button h-9 w-full rounded-full" aria-label="Észak felé" onClick={() => patchSpot(s.id, (x) => nudgeSpot(x, 0, step))}><ChevronUp className="h-4 w-4" /></Button>
                  <span />
                  <Button size="icon" variant="outline" className="glass-button h-9 w-full rounded-full" aria-label="Nyugat felé" onClick={() => patchSpot(s.id, (x) => nudgeSpot(x, -step, 0))}><ChevronLeft className="h-4 w-4" /></Button>
                  <span className="flex items-center justify-center text-[10px] text-muted-foreground">É↑</span>
                  <Button size="icon" variant="outline" className="glass-button h-9 w-full rounded-full" aria-label="Kelet felé" onClick={() => patchSpot(s.id, (x) => nudgeSpot(x, step, 0))}><ChevronRight className="h-4 w-4" /></Button>
                  <span />
                  <Button size="icon" variant="outline" className="glass-button h-9 w-full rounded-full" aria-label="Dél felé" onClick={() => patchSpot(s.id, (x) => nudgeSpot(x, 0, -step))}><ChevronDown className="h-4 w-4" /></Button>
                  <span />
                </div>
                {s.bias && (
                  <Button size="sm" variant="ghost" className="w-full rounded-full text-xs" onClick={() => patchSpot(s.id, (x) => ({ ...x, bias: null, learnedAt: null, samples: 0 }))}>Tanult eltérés törlése</Button>
                )}
              </div>
            );
          })}

          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" className="glass-button rounded-full" onClick={() => onPick({ placeId: place.id, spotId: null })}><Plus className="mr-1.5 h-4 w-4" />Pont a térképen</Button>
            <Button size="sm" variant="outline" className="glass-button rounded-full" onClick={addSpotHere}><MapPin className="mr-1.5 h-4 w-4" />Pont itt</Button>
          </div>

          {confirm === place.id ? (
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" className="glass-button rounded-full" onClick={() => setConfirm(null)}>Mégse</Button>
              <Button size="sm" variant="destructive" className="rounded-full" onClick={() => { onChange(places.filter((p) => p.id !== place.id)); setOpen(null); setConfirm(null); }}>Biztosan törlöm</Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="w-full rounded-full text-destructive" onClick={() => setConfirm(place.id)}><Trash2 className="mr-1.5 h-4 w-4" />Hely törlése</Button>
          )}
        </div>
      </ElasticScroll>
    </>
  );
}
