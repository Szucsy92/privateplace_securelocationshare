import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bell, Crosshair, LogOut, Plus, Route as RouteIcon, Settings2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { TRAIL_MS, appendTrackPoint, shouldPublishLocation } from "@/lib/tracking";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, syncProfile } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { MapPerson, TrackPoint } from "@/components/LiveMap";

const LiveMap = lazy(() => import("@/components/LiveMap"));

export const Route = createFileRoute("/_authenticated/terkep")({
  head: () => ({
    meta: [
      { title: "Élő térkép – másodpercre pontos követés" },
      {
        name: "description",
        content:
          "Kövesd valós időben, másodpercenként frissülve azokat, akik engedélyt adtak a helyzetük megosztására.",
      },
      { property: "og:title", content: "Élő térkép – másodpercre pontos követés" },
      {
        property: "og:description",
        content: "Valós idejű helymegosztás nyomvonallal, sebességgel és pontossággal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MapPage,
});

const COLORS = ["#3ddc97", "#ffc857", "#7aa2ff", "#ff7ab2", "#8be9fd", "#f78c6c"];

type Profile = { id: string; display_name: string | null; avatar_url: string | null; email: string };
type Follow = {
  id: string;
  follower_id: string;
  followed_id: string;
  status: "pending" | "accepted" | "rejected";
};
type LocRow = {
  user_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  recorded_at: string;
};


function MapPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [follows, setFollows] = useState<Follow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [tracks, setTracks] = useState<Record<string, TrackPoint[]>>({});
  const [meta, setMeta] = useState<Record<string, { speed: number | null; accuracy: number | null; at: number }>>({});
  const [sharing, setSharing] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [focus, setFocus] = useState<{ id: string; request: number } | null>(null);
  const [selfTracking, setSelfTracking] = useState(false);
  const [dialog, setDialog] = useState<"add" | "requests" | "settings" | null>(null);
  const [clock, setClock] = useState(Date.now());
  const privateTracksRef = useRef<TrackPoint[]>([]);
  const sharingRef = useRef(sharing);
  sharingRef.current = sharing;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const jumpTo = (id: string) => {
    if (!tracks[id]?.length) {
      toast.info(id === user?.id ? "Kapcsold be a saját követést a helyzetedhez." : "Még nem érkezett helyzet ettől a személytől.");
      return;
    }
    setFocus((previous) => ({ id, request: (previous?.request ?? 0) + 1 }));
  };
  const [emailInput, setEmailInput] = useState("");
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (user) void syncProfile(user);
  }, [user]);

  const loadRelations = useCallback(async () => {
    if (!user) return;
    const { data: rows } = await supabase
      .from("follows")
      .select("id, follower_id, followed_id, status")
      .or(`follower_id.eq.${user.id},followed_id.eq.${user.id}`);
    const list = (rows ?? []) as Follow[];
    setFollows(list);

    const ids = new Set<string>([user.id]);
    list.forEach((f) => {
      ids.add(f.follower_id);
      ids.add(f.followed_id);
    });
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url, email")
      .in("id", Array.from(ids));
    const map: Record<string, Profile> = {};
    (profs ?? []).forEach((p) => {
      map[p.id] = p as Profile;
    });
    setProfiles(map);
  }, [user]);

  useEffect(() => {
    void loadRelations();
  }, [loadRelations]);

  const trackedIds = useMemo(() => {
    if (!user) return [] as string[];
    const ids = follows
      .filter((f) => f.follower_id === user.id && f.status === "accepted")
      .map((f) => f.followed_id);
    return [user.id, ...ids];
  }, [follows, user]);

  // Kezdeti nyomvonalak
  useEffect(() => {
    if (!trackedIds.length) return;
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - TRAIL_MS).toISOString();
      const { data } = await supabase
        .from("locations")
        .select("user_id, lat, lng, accuracy, speed, recorded_at")
        .in("user_id", trackedIds)
        .gte("recorded_at", since)
        .order("recorded_at", { ascending: true })
        .limit(3000);
      if (cancelled) return;
      const next: Record<string, TrackPoint[]> = {};
      const nextMeta: Record<string, { speed: number | null; accuracy: number | null; at: number }> = {};
      ((data ?? []) as LocRow[]).forEach((row) => {
        const t = new Date(row.recorded_at).getTime();
        (next[row.user_id] ??= []).push({ lat: row.lat, lng: row.lng, t });
        nextMeta[row.user_id] = { speed: row.speed, accuracy: row.accuracy, at: t };
      });
      if (user && privateTracksRef.current.length) {
        next[user.id] = privateTracksRef.current;
      }
      setTracks(next);
      setMeta((previous) => user && privateTracksRef.current.length
        ? { ...nextMeta, [user.id]: previous[user.id] ?? nextMeta[user.id] }
        : nextMeta);
    })();
    return () => {
      cancelled = true;
    };
  }, [trackedIds.join(",")]);

  // Valós idejű pozíciók
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("live-locations")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "locations" },
        (payload) => {
          const row = payload.new as LocRow;
          if (!trackedIds.includes(row.user_id)) return;
          const t = new Date(row.recorded_at).getTime();
          setTracks((prev) => {
            const cutoff = Date.now() - TRAIL_MS;
            const list = [...(prev[row.user_id] ?? []), { lat: row.lat, lng: row.lng, t }].filter(
              (p) => p.t >= cutoff,
            );
            return { ...prev, [row.user_id]: list };
          });
          setMeta((prev) => ({
            ...prev,
            [row.user_id]: { speed: row.speed, accuracy: row.accuracy, at: t },
          }));
        },
      )
      .subscribe();

    const followChannel = supabase
      .channel("live-follows")
      .on("postgres_changes", { event: "*", schema: "public", table: "follows" }, () => {
        void loadRelations();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(followChannel);
    };
  }, [user, loadRelations, trackedIds.join(",")]);

  // Saját helyzet megosztása – másodpercenként
  useEffect(() => {
    if ((!selfTracking && !sharing) || !user) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }
    if (!("geolocation" in navigator)) {
      toast.error("Ez az eszköz nem támogatja a helymeghatározást");
      setSharing(false);
      setSelfTracking(false);
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: now };
        privateTracksRef.current = appendTrackPoint(privateTracksRef.current, point, now);
        setTracks((previous) => ({ ...previous, [user.id]: privateTracksRef.current }));
        setMeta((previous) => ({ ...previous, [user.id]: {
          speed: pos.coords.speed, accuracy: pos.coords.accuracy, at: now,
        } }));
        if (!shouldPublishLocation(sharingRef.current, now, lastSentRef.current)) return;
        lastSentRef.current = now;
        void supabase.from("locations").insert({
          user_id: user.id,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          speed: pos.coords.speed ?? null,
          heading: pos.coords.heading ?? null,
          recorded_at: new Date(now).toISOString(),
        }).then(({ error }) => {
          if (error) {
            toast.error("A helyzet megosztása nem sikerült. A saját követés folytatódik.");
            setSharing(false);
          }
        });
      },
      (err) => {
        toast.error(`Helymeghatározás hiba: ${err.message}`);
        setSharing(false);
        setSelfTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [selfTracking || sharing, user]);

  const people: MapPerson[] = useMemo(() => {
    return trackedIds
      .map((id, i) => {
        const profile = profiles[id];
        return {
          id,
          name: id === user?.id ? "Te" : (profile?.display_name ?? profile?.email ?? "Ismeretlen"),
          avatarUrl: profile?.avatar_url ?? null,
          color: COLORS[i % COLORS.length] ?? "#3ddc97",
          points: tracks[id] ?? [],
        };
      })
      .filter((p) => p.points.length > 0);
  }, [trackedIds, profiles, tracks, user]);

  const incoming = follows.filter((f) => f.followed_id === user?.id && f.status === "pending");
  const outgoing = follows.filter((f) => f.follower_id === user?.id);
  const watchers = follows.filter((f) => f.followed_id === user?.id && f.status === "accepted");

  const addPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    const { data, error } = await supabase.rpc("find_profile_by_email", { _email: email });
    if (error) {
      toast.error("Nem sikerült a keresés");
      return;
    }
    const found = (data ?? [])[0];
    if (!found) {
      toast.error("Nincs ilyen e-mail címmel regisztrált felhasználó");
      return;
    }
    if (found.id === user.id) {
      toast.error("Magadat nem kell hozzáadnod");
      return;
    }
    const { error: insErr } = await supabase
      .from("follows")
      .insert({ follower_id: user.id, followed_id: found.id });
    if (insErr) {
      toast.error("Már küldtél kérelmet ennek a személynek");
      return;
    }
    setEmailInput("");
    setDialog(null);
    toast.success("Kérelem elküldve. Amint elfogadja, élőben látod.");
    void loadRelations();
  };

  const respond = async (id: string, status: "accepted" | "rejected") => {
    await supabase.from("follows").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    void loadRelations();
  };

  const removeFollow = async (id: string) => {
    await supabase.from("follows").delete().eq("id", id);
    void loadRelations();
  };

  const signOut = async () => {
    setSharing(false);
    await supabase.auth.signOut();
    void navigate({ to: "/" });
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Betöltés…</div>;
  }

  const self = profiles[user?.id ?? ""];
  const ownMeta = meta[user?.id ?? ""];
  const ownFresh = ownMeta ? clock - ownMeta.at < 15000 : false;
  const avatar = (profile: Profile | undefined, color: string) => (
    <span className="person-avatar flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-surface-strong text-sm font-semibold" style={{ "--person-color": color } as React.CSSProperties}>
      {profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : (profile?.display_name ?? profile?.email ?? "?").charAt(0).toUpperCase()}
    </span>
  );

  return (
    <div className="map-workspace bg-background">
      <header className="z-10 flex shrink-0 items-center justify-between gap-2 border-b bg-surface px-3 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-base font-bold">Élő térkép</h1>
          <p className="truncate text-xs text-muted-foreground">{self?.display_name ?? user?.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Személy hozzáadása" title="Személy hozzáadása" onClick={() => setDialog("add")}><Plus className="h-5 w-5" /></Button>
          <Button variant="ghost" size="icon" className="relative" aria-label="Engedélykérések" title="Engedélykérések" onClick={() => setDialog("requests")}>
            <Bell className="h-5 w-5" />{incoming.length > 0 && <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">{incoming.length}</span>}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Beállítások" title="Beállítások" onClick={() => setDialog("settings")}><Settings2 className="h-5 w-5" /></Button>
        </div>
      </header>
      <main className="relative min-h-0 flex-1" aria-label="Térkép">
        <ClientOnly fallback={<div className="h-full bg-muted" />}>
          <Suspense fallback={<div className="h-full bg-muted" />}>
            <LiveMap people={people} focus={focus} showTrails={showTrails} />
          </Suspense>
        </ClientOnly>
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border bg-surface px-3 py-2 text-xs shadow-panel">
          <span className={selfTracking || sharing ? "live-dot" : "h-2 w-2 rounded-full bg-muted-foreground"} />
          {sharing ? `Megosztás · ${watchers.length} néző` : selfTracking ? "Saját követés" : "Követés kikapcsolva"}
        </div>
        <div className="absolute bottom-5 left-3 flex flex-col gap-2">
          <Button size="icon" variant="secondary" className="border shadow-panel" aria-label="Saját pozíció" title="Saját pozíció" onClick={() => user && jumpTo(user.id)}><Crosshair className="h-5 w-5" /></Button>
          <Button size="icon" variant={showTrails ? "default" : "secondary"} aria-label="Nyomvonal" title="Nyomvonal" aria-pressed={showTrails} onClick={() => setShowTrails(!showTrails)}><RouteIcon className="h-5 w-5" /></Button>
        </div>
      </main>
      <section className="shrink-0 border-t bg-surface" aria-label="Saját magam és akiket követek">
        <div className="people-rail">
          <article className="person-tile rounded-lg border border-primary/50 bg-background p-3">
            <div className="flex items-center gap-2">
              {avatar(self, COLORS[0] ?? "")}
              <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Saját magam</h2><p className="truncate text-xs text-muted-foreground">{ownMeta ? `${ownFresh ? "élő" : "utoljára " + relTime(ownMeta.at)} · ${kmh(ownMeta.speed)}` : "Még nincs helyzet"}</p></div>
              <Button variant="ghost" size="icon" aria-label="Ugrás saját magamhoz" title="Ugrás saját magamhoz" onClick={() => user && jumpTo(user.id)}><Crosshair className="h-5 w-5" /></Button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2"><label htmlFor="self-track" className="text-xs font-medium">Saját követés</label><Switch id="self-track" aria-label="Saját követés" checked={selfTracking} onCheckedChange={setSelfTracking} /></div>
          </article>
          {outgoing.map((f) => {
            const p = profiles[f.followed_id];
            const m = meta[f.followed_id];
            const idx = trackedIds.indexOf(f.followed_id);
            const color = COLORS[(idx < 0 ? 1 : idx) % COLORS.length] ?? "";
            const fresh = m ? clock - m.at < 15000 : false;
            const name = p?.display_name ?? p?.email ?? "Ismeretlen";
            return <article key={f.id} className="person-tile rounded-lg border bg-background p-3">
              <div className="flex items-center gap-2">{avatar(p, color)}<div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{name}</h2><p className="truncate text-xs text-muted-foreground">{f.status === "pending" ? "Jóváhagyásra vár" : f.status === "rejected" ? "Elutasítva" : m ? `${fresh ? "élő" : relTime(m.at)} · ${kmh(m.speed)}` : "Még nincs helyzet"}</p></div><Button variant="ghost" size="icon" disabled={f.status !== "accepted" || !tracks[f.followed_id]?.length} aria-label={`Ugrás: ${name}`} title={`Ugrás: ${name}`} onClick={() => jumpTo(f.followed_id)}><Crosshair className="h-5 w-5" /></Button></div>
              <div className="mt-3 flex h-6 items-center justify-between"><span className="text-xs text-muted-foreground">{m?.accuracy != null ? `Pontosság ±${Math.round(m.accuracy)} m` : "Nincs GPS-adat"}</span><Button variant="ghost" className="h-6 w-6" size="icon" aria-label={`Követés törlése: ${name}`} title="Követés törlése" onClick={() => removeFollow(f.id)}><X className="h-3 w-3" /></Button></div>
            </article>;
          })}
          {outgoing.length === 0 && <div className="flex w-44 shrink-0 flex-col items-start justify-center gap-2 px-2"><p className="text-xs text-muted-foreground">Még senkit nem követsz.</p><Button variant="outline" size="sm" onClick={() => setDialog("add")}><Plus className="mr-1 h-4 w-4" />Személy</Button></div>}
        </div>
      </section>
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-lg">
          <DialogHeader><DialogTitle>{dialog === "add" ? "Személy követése" : dialog === "requests" ? "Engedélykérések" : "Beállítások"}</DialogTitle><DialogDescription>{dialog === "add" ? "A követéshez a másik személy jóváhagyása szükséges." : dialog === "requests" ? "Te döntöd el, ki láthatja a megosztott helyzetedet." : "Saját követésed csak a megosztás bekapcsolásakor látható másoknak."}</DialogDescription></DialogHeader>
          {dialog === "add" && <form onSubmit={addPerson} className="space-y-3"><Input type="email" aria-label="Követett személy e-mail címe" placeholder="email@pelda.hu" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} required /><Button className="w-full" type="submit">Kérelem küldése</Button></form>}
          {dialog === "requests" && <div className="space-y-4">{incoming.length === 0 && <p className="text-sm text-muted-foreground">Nincs új engedélykérés.</p>}{incoming.map((f) => <div key={f.id} className="space-y-2"><p className="break-words text-sm">{profiles[f.follower_id]?.display_name ?? profiles[f.follower_id]?.email ?? "Valaki"}</p><div className="flex gap-2"><Button size="sm" onClick={() => respond(f.id, "accepted")}>Engedem</Button><Button size="sm" variant="outline" onClick={() => respond(f.id, "rejected")}>Elutasítom</Button></div></div>)}</div>}
          {dialog === "settings" && <div className="space-y-5"><div className="flex items-center justify-between gap-3"><label htmlFor="share" className="text-sm">Helyzetem megosztása</label><Switch id="share" aria-label="Megosztás" checked={sharing} onCheckedChange={setSharing} /></div><div className="flex items-center justify-between gap-3"><label htmlFor="trails" className="text-sm">Nyomvonal</label><Switch id="trails" checked={showTrails} onCheckedChange={setShowTrails} /></div><Button variant="outline" className="w-full" onClick={signOut}><LogOut className="mr-2 h-4 w-4" />Kilépés</Button></div>}
        </DialogContent>
      </Dialog>
    </div>
  );

}

function kmh(speed: number | null) {
  if (speed == null || Number.isNaN(speed)) return "– km/h";
  return `${Math.max(0, Math.round(speed * 3.6))} km/h`;
}

function relTime(at: number) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return `${s} mp`;
  if (s < 3600) return `${Math.round(s / 60)} perc`;
  return `${Math.round(s / 3600)} óra`;
}
