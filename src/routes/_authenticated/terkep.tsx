import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { toast } from "sonner";
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

const TRAIL_MS = 30 * 60 * 1000;

function MapPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [follows, setFollows] = useState<Follow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [tracks, setTracks] = useState<Record<string, TrackPoint[]>>({});
  const [meta, setMeta] = useState<Record<string, { speed: number | null; accuracy: number | null; at: number }>>({});
  const [sharing, setSharing] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [focusId, setFocusId] = useState<string | null>(null);
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
      setTracks(next);
      setMeta(nextMeta);
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
  }, [user, loadRelations]);

  // Saját helyzet megosztása – másodpercenként
  useEffect(() => {
    if (!sharing || !user) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }
    if (!("geolocation" in navigator)) {
      toast.error("Ez az eszköz nem támogatja a helymeghatározást");
      setSharing(false);
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSentRef.current < 1000) return;
        lastSentRef.current = now;
        void supabase.from("locations").insert({
          user_id: user.id,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          speed: pos.coords.speed ?? null,
          heading: pos.coords.heading ?? null,
          recorded_at: new Date(now).toISOString(),
        });
      },
      (err) => {
        toast.error(`Helymeghatározás hiba: ${err.message}`);
        setSharing(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [sharing, user]);

  const people: MapPerson[] = useMemo(() => {
    return trackedIds
      .map((id, i) => {
        const profile = profiles[id];
        return {
          id,
          name: id === user?.id ? "Te" : (profile?.display_name ?? profile?.email ?? "Ismeretlen"),
          avatarUrl: profile?.avatar_url ?? null,
          color: COLORS[i % COLORS.length]!,
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

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:flex-row">
      <aside className="order-2 flex w-full flex-col gap-5 border-border bg-surface p-5 lg:order-1 lg:w-[360px] lg:overflow-y-auto lg:border-r">
        <header className="flex items-center justify-between">
          <div>
            <p className="font-display text-lg font-bold">Élő térkép</p>
            <p className="text-xs text-muted-foreground">
              {profiles[user?.id ?? ""]?.display_name ?? user?.email}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            Kilépés
          </Button>
        </header>

        <section className="panel space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Saját helyzetem megosztása</p>
              <p className="text-xs text-muted-foreground">
                Másodpercenként küldi a pozíciódat a jóváhagyott követőidnek.
              </p>
            </div>
            <Switch checked={sharing} onCheckedChange={setSharing} aria-label="Megosztás" />
          </div>
          {sharing && (
            <p className="flex items-center gap-2 text-xs text-primary">
              <span className="live-dot" /> Élő adás fut – {watchers.length} néző
            </p>
          )}
        </section>

        <section className="panel space-y-3 p-4">
          <p className="text-sm font-semibold">Személy követése</p>
          <form onSubmit={addPerson} className="flex gap-2">
            <Input
              type="email"
              placeholder="email@pelda.hu"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
            />
            <Button type="submit">Kérés</Button>
          </form>
          <p className="text-xs text-muted-foreground">
            A követés csak akkor indul, ha az illető jóváhagyja.
          </p>
        </section>

        {incoming.length > 0 && (
          <section className="panel space-y-3 p-4">
            <p className="text-sm font-semibold">Engedélykérések</p>
            {incoming.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">
                  {profiles[f.follower_id]?.display_name ?? profiles[f.follower_id]?.email ?? "Valaki"}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => respond(f.id, "accepted")}>
                    Engedem
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => respond(f.id, "rejected")}>
                    Elutasít
                  </Button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="panel space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Akiket követek</p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Nyomvonal
              <Switch checked={showTrails} onCheckedChange={setShowTrails} aria-label="Nyomvonal" />
            </label>
          </div>
          {outgoing.length === 0 && (
            <p className="text-xs text-muted-foreground">Még senkit nem követsz.</p>
          )}
          {outgoing.map((f) => {
            const p = profiles[f.followed_id];
            const m = meta[f.followed_id];
            const idx = trackedIds.indexOf(f.followed_id);
            const color = COLORS[(idx < 0 ? 0 : idx) % COLORS.length];
            const fresh = m ? Date.now() - m.at < 15000 : false;
            return (
              <div
                key={f.id}
                className="flex items-center gap-3 rounded-lg bg-surface-strong p-3"
                role="button"
                tabIndex={0}
                onClick={() => setFocusId(f.followed_id)}
                onKeyDown={(e) => e.key === "Enter" && setFocusId(f.followed_id)}
              >
                <span
                  className="h-9 w-9 shrink-0 overflow-hidden rounded-full border-2"
                  style={{ borderColor: color }}
                >
                  {p?.avatar_url ? (
                    <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-xs">
                      {(p?.display_name ?? p?.email ?? "?").charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p?.display_name ?? p?.email ?? "Ismeretlen"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {f.status === "pending" && "Jóváhagyásra vár"}
                    {f.status === "rejected" && "Elutasítva"}
                    {f.status === "accepted" &&
                      (m
                        ? `${fresh ? "élő" : "utoljára " + relTime(m.at)} · ${kmh(m.speed)} · ±${Math.round(m.accuracy ?? 0)} m`
                        : "Még nem oszt meg helyzetet")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeFollow(f.id);
                  }}
                >
                  ✕
                </Button>
              </div>
            );
          })}
        </section>
      </aside>

      <main className="order-1 h-[55vh] w-full lg:order-2 lg:h-full lg:flex-1">
        <ClientOnly fallback={<div className="h-full w-full bg-muted" />}>
          <Suspense fallback={<div className="h-full w-full bg-muted" />}>
            <LiveMap people={people} focusId={focusId} showTrails={showTrails} />
          </Suspense>
        </ClientOnly>
      </main>
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
