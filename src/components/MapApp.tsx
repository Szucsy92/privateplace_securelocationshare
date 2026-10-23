import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  Camera,
  Copy,
  Crosshair,
  DoorOpen,
  ImagePlus,
  LogOut,
  Navigation2,
  Plus,
  QrCode,
  ScanLine,
  Settings2,
  Share2,
  Trash2,
  Users,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ElasticScroll } from "@/components/ElasticScroll";
import { QrScanner, canScanQr } from "@/components/QrScanner";
import type { MapPerson, Orientation, TrackPoint } from "@/components/LiveMap";
import { usePeerNetwork, type RemotePerson } from "@/hooks/usePeerNetwork";
import { useElasticOverscroll } from "@/hooks/useElasticOverscroll";
import { appendTrackPoint, clearTrackHistory, shouldPublishLocation } from "@/lib/tracking";
import { SELF_COLOR } from "@/lib/peerMessages";
import {
  addRoom,
  buildRoomLink,
  formatRoomToken,
  generateRoomToken,
  loadRooms,
  parseRoomInput,
  removeRoom,
  saveRooms,
  type SavedRoom,
} from "@/lib/rooms";
import {
  DEFAULT_PREFS,
  getDeviceId,
  loadPrefs,
  loadProfile,
  resizeAvatar,
  savePrefs,
  saveProfile,
  type LocalProfile,
  type Prefs,
} from "@/lib/profile";
import { isNativeApp, startLocationWatch } from "@/lib/locationSource";

const LiveMap = lazy(() => import("@/components/LiveMap"));
const SELF = "self";

type DialogKind = "welcome" | "rooms" | "settings" | "share" | "join" | null;
type GpsStatus = "waiting" | "live" | "denied" | "error";

function shareBase(): string | null {
  const configured = import.meta.env["VITE_PUBLIC_APP_URL"] as string | undefined;
  if (configured) return configured;
  const { protocol, hostname, origin } = window.location;
  if (!protocol.startsWith("http") || hostname === "localhost" || hostname === "127.0.0.1") return null;
  return origin;
}

export default function MapApp() {
  const [mounted, setMounted] = useState(false);
  const [nativeApp, setNativeApp] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [rooms, setRooms] = useState<SavedRoom[]>([]);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [pendingJoin, setPendingJoin] = useState<{ token: string; name: string | null } | null>(null);
  const [follow, setFollow] = useState<{ id: string; request: number } | null>(null);
  const [selfTrack, setSelfTrack] = useState<TrackPoint[]>([]);
  const [selfMeta, setSelfMeta] = useState<{ speed: number | null; acc: number | null; at: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("waiting");
  const [gpsRequest, setGpsRequest] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const selfTrackRef = useRef<TrackPoint[]>([]);
  const lastSentRef = useRef(0);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const compassRef = useRef<HTMLSpanElement | null>(null);
  const railRef = useElasticOverscroll<HTMLDivElement>("x");

  // Helyi adatok betöltése (csak a telefonon)
  useEffect(() => {
    setNativeApp(isNativeApp());
    setDeviceId(getDeviceId());
    const p = loadProfile();
    setProfile(p);
    setPrefs(loadPrefs());
    setRooms(loadRooms());
    const parsed = window.location.hash ? parseRoomInput(window.location.hash) : null;
    if (parsed) {
      setPendingJoin(parsed);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setDialog(p ? (parsed ? "join" : null) : "welcome");
    setMounted(true);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const updatePrefs = (patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  };

  const updateRooms = useCallback((fn: (prev: SavedRoom[]) => SavedRoom[]) => {
    setRooms((prev) => {
      const next = fn(prev);
      saveRooms(next);
      return next;
    });
  }, []);

  const onRoomClosed = useCallback(
    (token: string) => {
      updateRooms((prev) => {
        const room = prev.find((r) => r.token === token);
        if (room && !room.owner) toast.info(`A(z) „${room.name}” szobát a létrehozója törölte.`);
        return room && !room.owner ? removeRoom(prev, token) : prev;
      });
    },
    [updateRooms],
  );

  const net = usePeerNetwork({ rooms, deviceId, profile, onRoomClosed });

  // Saját GPS: mindig fut, privát; csak a megosztás kapcsoló küld a szobatársaknak.
  // Az Android-alkalmazásban bekapcsolt megosztásnál lezárt képernyőnél is folytatódik.
  const backgroundSharing = nativeApp && prefs.sharing;
  useEffect(() => {
    if (!mounted || !profile) return;
    setGpsStatus((s) => (s === "live" ? s : "waiting"));
    return startLocationWatch({
      background: backgroundSharing,
      onFix: (fix) => {
        const now = Date.now();
        const point = { lat: fix.lat, lng: fix.lng, t: now };
        selfTrackRef.current = appendTrackPoint(selfTrackRef.current, point, now);
        setSelfTrack(selfTrackRef.current);
        setSelfMeta({ speed: fix.speed, acc: fix.acc, at: now });
        setGpsStatus("live");
        if (!shouldPublishLocation(prefsRef.current.sharing, now, lastSentRef.current)) return;
        lastSentRef.current = now;
        net.sendLocation({ lat: fix.lat, lng: fix.lng, t: now, acc: fix.acc, speed: fix.speed });
      },
      onError: (err) => setGpsStatus(err),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, profile !== null, gpsRequest, backgroundSharing]);

  // Csatlakozási gond (pl. két szigorú mobilnet között) – egyszer jelezzük.
  const warnedIssueRef = useRef(false);
  useEffect(() => {
    if (net.connectIssues > 0 && !warnedIssueRef.current) {
      warnedIssueRef.current = true;
      toast.warning("Egy szobatársaddal nem sikerült közvetlen kapcsolatot létesíteni. Próbáljátok Wi-Fi-n, vagy egy kicsit később.");
    }
  }, [net.connectIssues]);

  const setSharing = (value: boolean) => {
    updatePrefs({ sharing: value });
    if (!value) {
      net.sendLocation(null);
      return;
    }
    const last = selfTrackRef.current[selfTrackRef.current.length - 1];
    if (last) {
      lastSentRef.current = Date.now();
      net.sendLocation({ lat: last.lat, lng: last.lng, t: last.t, acc: selfMeta?.acc ?? null, speed: selfMeta?.speed ?? null });
    }
  };

  const remote = useMemo(
    () =>
      Object.values(net.people).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, "hu")),
    [net.people],
  );

  const mapPeople: MapPerson[] = useMemo(() => {
    const list: MapPerson[] = [];
    if (profile && selfTrack.length)
      list.push({ id: SELF, name: profile.name, avatarUrl: profile.avatar, color: SELF_COLOR, points: selfTrack, isSelf: true });
    for (const p of remote) {
      if (p.sharing && p.points.length)
        list.push({ id: p.deviceId, name: p.name, avatarUrl: p.avatar, color: p.color, points: p.points });
    }
    return list;
  }, [profile, selfTrack, remote]);

  const hasPosition = (id: string) => mapPeople.some((p) => p.id === id);

  const toggleFollow = (id: string) => {
    if (follow?.id === id) {
      setFollow(null);
      return;
    }
    if (!hasPosition(id)) {
      toast.info(id === SELF ? "Még keresem a helyzetedet. Engedélyezd a helyhozzáférést." : "Ő most nem osztja meg a helyzetét.");
      return;
    }
    setFollow((prev) => ({ id, request: (prev?.request ?? 0) + 1 }));
  };

  const toggleOrientation = () => {
    const next: Orientation = prefs.orientation === "north" ? "heading" : "north";
    updatePrefs({ orientation: next });
    if (next === "heading" && !follow && hasPosition(SELF)) setFollow((prev) => ({ id: SELF, request: (prev?.request ?? 0) + 1 }));
  };

  const createRoom = () => {
    const token = generateRoomToken();
    const owned = rooms.filter((r) => r.owner).length;
    updateRooms((prev) => addRoom(prev, { token, name: owned ? `Szobám ${owned + 1}` : "Szobám", owner: true, createdAt: Date.now() }));
    setShareToken(token);
    setDialog("share");
  };

  const joinRoom = (token: string, name: string | null) => {
    if (rooms.some((r) => r.token === token)) {
      toast.info("Ebben a szobában már benne vagy.");
    } else {
      updateRooms((prev) => addRoom(prev, { token, name: name || "Meghívott szoba", owner: false, createdAt: Date.now() }));
      toast.success("Csatlakoztál. Amint a többiek is online vannak, látjátok egymást.");
    }
    setPendingJoin(null);
    setDialog(null);
  };

  const deleteRoom = async (room: SavedRoom) => {
    if (room.owner) await net.announceClose(room.token);
    updateRooms((prev) => removeRoom(prev, room.token));
    toast.success(room.owner ? "A szoba törölve. A régi link többé nem működik." : "Kiléptél a szobából.");
  };

  const onlineCount = remote.filter((p) => p.online).length;
  const selfFresh = selfMeta ? clock - selfMeta.at < 15000 : false;

  if (!mounted) return <div className="map-workspace glass-shell" />;

  return (
    <div className="map-workspace glass-shell">
      <header className="glass z-10 flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-base font-bold">Élő Hely</h1>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="status-dot" data-state={prefs.sharing ? "on" : "off"} />
            <span className="truncate">
              {prefs.sharing ? "Megosztás aktív" : "Megosztás kikapcsolva"} · {rooms.length} szoba
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="indicator relative rounded-full"
            data-state={onlineCount > 0 ? "on" : "off"}
            aria-label="Szobák"
            title="Szobák"
            onClick={() => setDialog("rooms")}
          >
            <Users className="h-5 w-5" />
            {onlineCount > 0 && <span className="count-badge">{onlineCount}</span>}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="indicator rounded-full"
            data-state={dialog === "settings" ? "on" : "off"}
            aria-label="Beállítások"
            title="Beállítások"
            onClick={() => setDialog("settings")}
          >
            <Settings2 className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="map-panel min-h-0 flex-1" aria-label="Térkép">
        <Suspense fallback={<div className="h-full" />}>
          <LiveMap
            people={mapPeople}
            follow={follow}
            showTrails={prefs.showTrails}
            orientation={prefs.orientation}
            onUserPan={() => setFollow(null)}
            compassRef={compassRef}
          />
        </Suspense>

        <div className="map-overlay glass absolute left-3 top-3 flex items-center gap-2 rounded-full px-3 py-2 text-xs">
          <span className="status-dot" data-state={gpsStatus === "live" ? "on" : gpsStatus === "waiting" ? "off" : "warn"} />
          <span>
            {gpsStatus === "denied"
              ? "Helyhozzáférés szükséges"
              : gpsStatus === "error"
                ? "Nincs GPS-jel"
                : gpsStatus === "waiting"
                  ? "Helyzet keresése…"
                  : prefs.sharing
                    ? "Élő · megosztva"
                    : "Élő · privát"}
          </span>
          {(gpsStatus === "denied" || gpsStatus === "error") && (
            <button className="underline underline-offset-2" onClick={() => setGpsRequest((n) => n + 1)}>
              Újra
            </button>
          )}
        </div>

        <button
          className="map-overlay indicator glass compass-btn absolute right-3 top-3"
          data-state={prefs.orientation === "heading" ? "on" : "off"}
          aria-label={prefs.orientation === "heading" ? "Haladási irány felül – váltás északra" : "Észak felül – váltás haladási irányra"}
          title={prefs.orientation === "heading" ? "Haladási irány felül" : "Észak felül"}
          onClick={toggleOrientation}
        >
          <span ref={compassRef} className="compass-needle">
            {prefs.orientation === "heading" ? <Navigation2 className="h-5 w-5" /> : <span className="font-display text-sm font-bold">N</span>}
          </span>
        </button>

        <Button
          size="icon"
          variant="ghost"
          className="map-overlay indicator glass absolute bottom-4 left-3 h-12 w-12 rounded-full"
          data-state={follow?.id === SELF ? "on" : "off"}
          aria-label={follow?.id === SELF ? "Saját követés kikapcsolása" : "Saját pozíció követése"}
          title={follow?.id === SELF ? "Követés kikapcsolása" : "Saját pozíció"}
          onClick={() => toggleFollow(SELF)}
        >
          <Crosshair className="h-5 w-5" />
        </Button>
      </main>

      <section className="people-rail-wrap shrink-0" aria-label="Saját magam és a szobatársaim">
        <div ref={railRef} className="people-rail">
          <div className="people-track">
            {profile && (
              <PersonCapsule
                name="Saját magam"
                avatar={profile.avatar}
                fallback={profile.name}
                color={SELF_COLOR}
                active={follow?.id === SELF}
                dot={selfFresh ? "on" : gpsStatus === "denied" || gpsStatus === "error" ? "warn" : "off"}
                status={selfMeta ? `${selfFresh ? "élő" : relTime(selfMeta.at, clock)} · ${kmh(selfMeta.speed)}` : "Helyzet keresése…"}
                onClick={() => toggleFollow(SELF)}
              />
            )}
            {remote.map((p) => (
              <PersonCapsule
                key={p.deviceId}
                name={p.name}
                avatar={p.avatar}
                fallback={p.name}
                color={p.color}
                active={follow?.id === p.deviceId}
                dot={p.online && p.sharing && p.at && clock - p.at < 15000 ? "on" : "off"}
                status={personStatus(p, clock)}
                onClick={() => toggleFollow(p.deviceId)}
              />
            ))}
            {remote.length === 0 && (
              <button className="capsule capsule-invite" onClick={() => setDialog("rooms")}>
                <span className="capsule-avatar capsule-avatar-plus">
                  <Plus className="h-6 w-6" />
                </span>
                <span className="flex min-w-0 flex-col items-start pr-4 text-left">
                  <span className="text-sm font-semibold">Meghívás</span>
                  <span className="text-[11px] text-muted-foreground">Szoba és QR-kód</span>
                </span>
              </button>
            )}
          </div>
        </div>
      </section>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && dialog !== "welcome") {
            setDialog(null);
            setPendingJoin(null);
          }
        }}
      >
        <DialogContent
          className="glass-dialog w-[calc(100%-1.5rem)] max-w-sm gap-0 p-0"
          onInteractOutside={(e) => dialog === "welcome" && e.preventDefault()}
          onEscapeKeyDown={(e) => dialog === "welcome" && e.preventDefault()}
        >
          {dialog === "welcome" && (
            <ProfileForm
              title="Üdv az Élő Helyen"
              description="Nincs regisztráció és nincs jelszó. A neved és a képed csak ezen a telefonon tárolódik, és csak a szobatársaid látják."
              initial={null}
              submitLabel="Kezdés"
              onSave={(p) => {
                saveProfile(p);
                setProfile(p);
                setDialog(pendingJoin ? "join" : null);
              }}
            />
          )}

          {dialog === "join" && <JoinPanel initial={pendingJoin} onJoin={joinRoom} />}

          {dialog === "share" && shareToken && (
            <SharePanel room={rooms.find((r) => r.token === shareToken) ?? null} onDone={() => setDialog("rooms")} />
          )}

          {dialog === "rooms" && (
            <>
              <PanelHeader title="Szobák" description="Csak az lát téged, akinek elküldöd a szobád kódját vagy QR-kódját." />
              <ElasticScroll className="max-h-[52dvh] px-5">
                <div className="space-y-2.5 pb-1">
                  {rooms.length === 0 && (
                    <p className="glass-inset rounded-2xl p-4 text-sm text-muted-foreground">
                      Még nincs szobád. Hozz létre egyet, és küldd el a QR-kódot annak, akivel kölcsönösen látni szeretnétek egymást.
                    </p>
                  )}
                  {rooms.map((room) => (
                    <RoomRow
                      key={room.token}
                      room={room}
                      peers={net.roomPeers[room.token] ?? 0}
                      onShare={() => {
                        setShareToken(room.token);
                        setDialog("share");
                      }}
                      onDelete={() => void deleteRoom(room)}
                    />
                  ))}
                </div>
              </ElasticScroll>
              <div className="grid grid-cols-2 gap-2 p-5 pt-4">
                <Button className="rounded-full" onClick={createRoom}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Új szoba
                </Button>
                <Button variant="outline" className="glass-button rounded-full" onClick={() => setDialog("join")}>
                  <DoorOpen className="mr-1.5 h-4 w-4" />
                  Csatlakozás
                </Button>
              </div>
            </>
          )}

          {dialog === "settings" && profile && (
            <>
              <PanelHeader title="Beállítások" description="A helyzeted közvetlenül a szobatársaid telefonjára megy, központi tárolás nélkül." />
              <ElasticScroll className="max-h-[66dvh] px-5 pb-5">
                <div className="space-y-4">
                  <div className="glass-inset space-y-3 rounded-2xl p-4">
                    <SettingRow label="Helyzetem megosztása" hint="Bekapcsolva a szobatársaid élőben látják, merre jársz.">
                      <Switch
                        aria-label="Helyzetem megosztása"
                        checked={prefs.sharing}
                        className="indicator"
                        data-indicator={prefs.sharing ? "on" : "off"}
                        onCheckedChange={setSharing}
                      />
                    </SettingRow>
                  </div>

                  <div className="glass-inset space-y-3 rounded-2xl p-4">
                    <label className="flex items-center gap-3 text-sm">
                      <Checkbox checked={prefs.showTrails} onCheckedChange={(v) => updatePrefs({ showTrails: v === true })} />
                      Útvonalak kirajzolása a térképen
                    </label>
                    <div className="space-y-2">
                      <p className="text-sm">Térkép tájolása</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="indicator glass-button rounded-full"
                          data-state={prefs.orientation === "north" ? "on" : "off"}
                          onClick={() => updatePrefs({ orientation: "north" })}
                        >
                          Észak felül
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="indicator glass-button rounded-full"
                          data-state={prefs.orientation === "heading" ? "on" : "off"}
                          onClick={() => {
                            if (prefs.orientation !== "heading") toggleOrientation();
                          }}
                        >
                          Haladási irány
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Egy személyre koppintva a térkép követi és középen tartja őt; újabb koppintásra a követés kikapcsol.
                      </p>
                    </div>
                  </div>

                  <div className="glass-inset rounded-2xl p-4">
                    <ProfileForm
                      compact
                      initial={profile}
                      submitLabel="Profil mentése"
                      onSave={(p) => {
                        saveProfile(p);
                        setProfile(p);
                        toast.success("Profil mentve");
                      }}
                    />
                  </div>

                  <Button
                    variant="outline"
                    className="glass-button w-full rounded-full"
                    onClick={() => {
                      selfTrackRef.current = clearTrackHistory(selfTrackRef.current);
                      setSelfTrack(selfTrackRef.current);
                      toast.success("A saját útvonalad törölve erről a telefonról.");
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Saját útvonal törlése
                  </Button>
                </div>
              </ElasticScroll>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PanelHeader({ title, description }: { title: string; description: string }) {
  return (
    <DialogHeader className="p-5 pb-4 pr-12 text-left">
      <DialogTitle className="font-display text-lg">{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
  );
}

function SettingRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function PersonCapsule(props: {
  name: string;
  avatar: string | null;
  fallback: string;
  color: string;
  active: boolean;
  dot: "on" | "off" | "warn";
  status: string;
  onClick: () => void;
}) {
  return (
    <button
      className="capsule indicator"
      data-state={props.active ? "on" : "off"}
      aria-pressed={props.active}
      aria-label={`${props.name} – ${props.active ? "követés kikapcsolása" : "követés"}`}
      onClick={props.onClick}
    >
      <span className="capsule-avatar" style={{ "--person-color": props.color } as React.CSSProperties}>
        {props.avatar ? <img src={props.avatar} alt="" /> : (props.fallback || "?").charAt(0).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-col items-start pr-4 text-left">
        <span className="max-w-[118px] truncate text-sm font-semibold">{props.name}</span>
        <span className="flex max-w-[118px] items-center gap-2 text-[11px] text-muted-foreground">
          <span className="status-dot shrink-0" data-state={props.dot} />
          <span className="truncate">{props.status}</span>
        </span>
      </span>
    </button>
  );
}

function RoomRow({ room, peers, onShare, onDelete }: { room: SavedRoom; peers: number; onShare: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="glass-inset rounded-2xl p-3">
      <div className="flex items-center gap-3">
        <span className="status-dot ml-1 shrink-0" data-state={peers > 0 ? "on" : "off"} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{room.name}</p>
          <p className="text-xs text-muted-foreground">
            {room.owner ? "Saját szoba" : "Meghívás"} · {peers > 0 ? `${peers} kapcsolódva` : "várakozás a többiekre"}
          </p>
        </div>
        {room.owner && (
          <Button variant="ghost" size="icon" className="rounded-full" aria-label={`QR-kód: ${room.name}`} title="QR-kód és megosztás" onClick={onShare}>
            <QrCode className="h-5 w-5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full text-destructive"
          aria-label={room.owner ? `Szoba törlése: ${room.name}` : `Kilépés: ${room.name}`}
          title={room.owner ? "Szoba törlése" : "Kilépés"}
          onClick={() => setConfirm(true)}
        >
          {room.owner ? <Trash2 className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
        </Button>
      </div>
      {confirm && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          <p className="text-xs text-muted-foreground">
            {room.owner
              ? "Törlöd a szobát? Mindenki kikerül belőle, és a régi kód vagy link többé nem működik."
              : "Kilépsz a szobából? Újra csak egy új meghívással léphetsz vissza."}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" className="rounded-full" onClick={onDelete}>
              {room.owner ? "Törlés" : "Kilépés"}
            </Button>
            <Button size="sm" variant="outline" className="glass-button rounded-full" onClick={() => setConfirm(false)}>
              Mégsem
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SharePanel({ room, onDone }: { room: SavedRoom | null; onDone: () => void }) {
  if (!room) return null;
  const base = shareBase();
  const link = base ? buildRoomLink(base, room.token, room.name) : null;
  const code = formatRoomToken(room.token);
  const text = link ?? code;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(link ? "Link másolva" : "Kód másolva");
    } catch {
      toast.error("A másolás nem sikerült");
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: "Élő Hely meghívó", text: link ? "Csatlakozz a szobámhoz:" : `Szobakód: ${code}`, ...(link ? { url: link } : {}) });
    } catch {
      /* a felhasználó bezárta */
    }
  };

  return (
    <>
      <PanelHeader title={room.name} description="Csak az látja a helyzetedet, akinek ezt elküldöd. Bármikor törölheted a szobát." />
      <ElasticScroll className="max-h-[70dvh] px-5 pb-5">
        <div className="flex flex-col items-center gap-4">
          <div className="qr-frame">
            <QRCodeSVG value={text} size={196} level="M" bgColor="#ffffff" fgColor="#0d1424" marginSize={0} />
          </div>
          <div className="glass-inset w-full rounded-2xl p-3 text-center">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Szobakód</p>
            <p className="mt-1 break-all font-display text-base font-bold tracking-wider">{code}</p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2">
            <Button variant="outline" className="glass-button rounded-full" onClick={() => void copy()}>
              <Copy className="mr-1.5 h-4 w-4" />
              {link ? "Link" : "Kód"} másolása
            </Button>
            {"share" in navigator ? (
              <Button className="rounded-full" onClick={() => void share()}>
                <Share2 className="mr-1.5 h-4 w-4" />
                Küldés
              </Button>
            ) : (
              <Button className="rounded-full" onClick={onDone}>
                Kész
              </Button>
            )}
          </div>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={onDone}>
            Vissza a szobákhoz
          </Button>
        </div>
      </ElasticScroll>
    </>
  );
}

function JoinPanel({ initial, onJoin }: { initial: { token: string; name: string | null } | null; onJoin: (token: string, name: string | null) => void }) {
  const [value, setValue] = useState(initial ? formatRoomToken(initial.token) : "");
  const [scanning, setScanning] = useState(false);
  const parsed = parseRoomInput(value);
  const name = parsed?.name ?? initial?.name ?? null;

  return (
    <>
      <PanelHeader
        title={initial ? "Meghívást kaptál" : "Csatlakozás szobához"}
        description={initial ? `Csatlakozol a(z) „${initial.name ?? "meghívott"}” szobához? Ott kölcsönösen láthatjátok egymást, ha bekapcsoljátok a megosztást.` : "Olvasd be a QR-kódot, vagy írd be a kapott kódot, illetve linket."}
      />
      <ElasticScroll className="max-h-[70dvh] px-5 pb-5">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed) onJoin(parsed.token, name);
            else toast.error("Ez nem érvényes szobakód vagy link.");
          }}
        >
          {scanning && (
            <QrScanner
              onResult={(text) => {
                setScanning(false);
                const p = parseRoomInput(text);
                if (p) setValue(text);
                else toast.error("Ez a QR-kód nem Élő Hely meghívó.");
              }}
            />
          )}
          <Input
            aria-label="Szobakód vagy link"
            placeholder="ABCDE-FGHJK-…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="glass-input h-11 rounded-full px-4"
          />
          {canScanQr() && (
            <Button type="button" variant="outline" className="glass-button w-full rounded-full" onClick={() => setScanning((s) => !s)}>
              {scanning ? <ScanLine className="mr-1.5 h-4 w-4" /> : <Camera className="mr-1.5 h-4 w-4" />}
              {scanning ? "Beolvasás leállítása" : "QR-kód beolvasása"}
            </Button>
          )}
          <Button type="submit" className="w-full rounded-full" disabled={!parsed}>
            Csatlakozás
          </Button>
        </form>
      </ElasticScroll>
    </>
  );
}

function ProfileForm(props: {
  title?: string;
  description?: string;
  initial: LocalProfile | null;
  submitLabel: string;
  compact?: boolean;
  onSave: (p: LocalProfile) => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? "");
  const [avatar, setAvatar] = useState<string | null>(props.initial?.avatar ?? null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const body = (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const clean = name.trim().slice(0, 40);
        if (!clean) return;
        props.onSave({ name: clean, avatar });
      }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="capsule-avatar profile-avatar"
          style={{ "--person-color": SELF_COLOR } as React.CSSProperties}
          aria-label="Profilkép választása"
          onClick={() => fileRef.current?.click()}
        >
          {avatar ? <img src={avatar} alt="" /> : <ImagePlus className="h-5 w-5" />}
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <Input
            aria-label="Megjelenő név"
            placeholder="A neved"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="glass-input h-11 rounded-full px-4"
          />
          {avatar && (
            <button type="button" className="px-2 text-xs text-muted-foreground underline underline-offset-2" onClick={() => setAvatar(null)}>
              Kép eltávolítása
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              setAvatar(await resizeAvatar(file));
            } catch {
              toast.error("Ezt a képet nem sikerült betölteni.");
            }
            e.target.value = "";
          }}
        />
      </div>
      <Button type="submit" className="w-full rounded-full" disabled={!name.trim()}>
        {props.submitLabel}
      </Button>
    </form>
  );

  if (props.compact) return body;
  return (
    <>
      <PanelHeader title={props.title ?? ""} description={props.description ?? ""} />
      <div className="px-5 pb-5">{body}</div>
    </>
  );
}

function personStatus(p: RemotePerson, now: number) {
  if (!p.online) return p.at ? `nincs kapcsolat · ${relTime(p.at, now)}` : "nincs kapcsolat";
  if (!p.sharing) return "nem oszt meg";
  if (!p.at) return "csatlakozva";
  return `${now - p.at < 15000 ? "élő" : relTime(p.at, now)} · ${kmh(p.speed)}`;
}

function kmh(speed: number | null) {
  if (speed == null || Number.isNaN(speed)) return "– km/h";
  return `${Math.max(0, Math.round(speed * 3.6))} km/h`;
}

function relTime(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s} mp`;
  if (s < 3600) return `${Math.round(s / 60)} perc`;
  return `${Math.round(s / 3600)} óra`;
}
