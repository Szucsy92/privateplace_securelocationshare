import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  BatteryCharging,
  ChevronDown,
  Sun,
  Moon,
  Check,
  X,
  Bell,
  Camera,
  Copy,
  DoorOpen,
  ImagePlus,
  LockKeyhole,
  LogOut,
  HelpCircle,
  Pause,
  Play,
  MapPin,
  Navigation2,
  ChevronLeft,
  ChevronRight,
  Plus,
  QrCode,
  ScanLine,
  Settings2,
  Share2,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  customizeRoom,
  ROOM_COLORS,
  DEFAULT_ROOM_COLOR,
  type RoomColor,
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
import { SharingControl, type SharingStatus } from "@/components/SharingControl";
import { TransportControl, TRANSPORT_DEMO_EVENT } from "@/components/TransportControl";
import { hybridHeading, type HeadingState } from "@/lib/heading";
import { watchCompass, watchBattery, requestCompassPermission } from "@/lib/deviceSensors";
import { watchNativeStop } from "@/lib/nativeRuntime";
import { updateTransport, type TransportMode, type TransportState } from "@/lib/transport";
import { createDriftFilter, updateStop, type StopState } from "@/lib/stationary";
import { latestRelease, releaseRepository, needsUpdate, appLink, isAndroidBrowser, type AppRelease } from "@/lib/invitations";
import { headingFromTrack } from "@/lib/mapMath";
import { isNativeApp, prepareSharing, startLocationWatch } from "@/lib/locationSource";
import { createRoomAuthority, signRoomControl } from "@/lib/moderation";
import {
  checkAllPermissions,
  permissionDiagnostics,
  markPermissionsAsked,
  openPermissionSettings,
  permissionKeys,
  permissionsAsked,
  requestAllPermissions,
  requestPermission,
  type PermKey,
  type PermMap,
  type PermState,
} from "@/lib/permissions";
import { installChunkReload, lazyImportWithReload } from "@/lib/chunkReload";

installChunkReload();
/** A „csak hozzávetőleges helyzet” figyelmeztetés alkalmanként egyszer jelenik meg. */
let preciseHintShown = false;
let notificationHintShown = false;

const LiveMap = lazy(lazyImportWithReload(() => import("@/components/LiveMap")));
const SELF = "self";

type DialogKind = "welcome" | "permissions" | "viewers" | "rooms" | "settings" | "share" | "join" | null;
type GpsStatus = "waiting" | "live" | "denied" | "error";

/** Az éles térképablak helye és mérete a teljes képernyőhöz képest (képpontban). */
type MapWindow = { x: number; y: number; w: number; h: number; vw: number; vh: number; radius: number };

/** A teljes képernyős elmosó fólia kivágása: lekerekített téglalap az ablak helyén (even-odd szabállyal). */
function holePath(win: MapWindow): string {
  const { x, y, w, h, vw, vh } = win;
  const r = Math.max(0, Math.min(win.radius, w / 2, h / 2));
  return `M0 0H${vw}V${vh}H0Z M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

function veilStyle(win: MapWindow): CSSProperties {
  const clip = `path(evenodd, "${holePath(win)}")`;
  return { clipPath: clip, WebkitClipPath: clip };
}

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
  const [pendingJoin, setPendingJoin] = useState<{ token: string; name: string | null; color?: RoomColor; ownerKey?: string } | null>(null);
  const [follow, setFollow] = useState<{ id: string; request: number } | null>(null);
  const [selfTrack, setSelfTrack] = useState<TrackPoint[]>([]);
  const [selfMeta, setSelfMeta] = useState<{ speed: number | null; acc: number | null; at: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("waiting");
  const [gpsRequest, setGpsRequest] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [hintsKey, setHintsKey] = useState(0);
  const selfTrackRef = useRef<TrackPoint[]>([]);
  const lastSentRef = useRef(0);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const compassRef = useRef<HTMLSpanElement | null>(null);
  const railRef = useElasticOverscroll<HTMLDivElement>("x");
  const headingRef = useRef<HeadingState>({ source: "gps", angle: null });
  const sensorRef = useRef<number | null>(null);
  const fixBearingRef = useRef<number | null>(null);
  const batteryRef = useRef<number | null>(null);
  const stopRef = useRef<StopState | null>(null);
  const sinceRef = useRef<number | null>(null);
  const manualRef = useRef<TransportMode | null>(null);
  const transportRef = useRef<TransportState>({ mode: "walk", candidate: null, candidateAt: 0 });
  const [transport, setTransport] = useState<TransportMode>("walk");
  const [manualTransport, setManualTransport] = useState<TransportMode | null>(null);
  const [selfHeading, setSelfHeading] = useState<number | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [stopped, setStopped] = useState(false);
  const addressAllowed = prefs.addressConsent === "yes";
  const [addressAskHidden, setAddressAskHidden] = useState(false);
  const [settingsView, setSettingsView] = useState<"main" | "trails">("main");
  useEffect(() => { if (dialog !== "settings") setSettingsView("main"); }, [dialog]);
  const [nativeStopReady, setNativeStopReady] = useState(false);
  const invitationRepoRef = useRef<string | null>(null);
  const selfMetaRef = useRef(selfMeta);
  selfMetaRef.current = selfMeta;
  const publishSelf = () => {
    const last = selfTrackRef.current.at(-1);
    if (!prefsRef.current.sharing || !last || Date.now() - last.t > 15000) return;
    net.sendLocation({ lat: last.lat, lng: last.lng, t: last.t, speed: selfMetaRef.current?.speed ?? null, acc: selfMetaRef.current?.acc ?? null, heading: headingRef.current.angle, battery: batteryRef.current, since: sinceRef.current, stoppedSince: stopRef.current?.since ?? null, transport: transportRef.current.mode });
  };
  const publishRef = useRef(publishSelf);
  publishRef.current = publishSelf;
  useEffect(() => {
    if (!mounted || !profile || stopped) return;
    const stopCompass = watchCompass(angle => {
      sensorRef.current = angle;
      headingRef.current = hybridHeading(headingRef.current, selfMetaRef.current?.speed ?? null, fixBearingRef.current, angle);
      setSelfHeading(headingRef.current.angle);
    });
    const stopBattery = watchBattery(value => { batteryRef.current = value; setBattery(value); });
    const timer = setInterval(() => publishRef.current(), 1000);
    return () => { stopCompass(); stopBattery(); clearInterval(timer); };
  }, [mounted, profile !== null, stopped]);
  useEffect(() => {
    if (!mounted) return;
    return watchNativeStop(exit => { setSharingRef.current(false); if (exit) setStopped(true); }, () => setNativeStopReady(true));
  }, [mounted]);
  useEffect(() => {
    if (!nativeApp) return;
    let cancelled = false;
    let cleanup = () => {};
    void import("@capacitor/app").then(async ({ App }) => {
      const receive = (url: string) => {
        const invitation = parseRoomInput(url);
        if (!invitation) return;
        setPendingJoin(invitation);
        setDialog(loadProfile() ? "join" : "welcome");
      };
      const listener = await App.addListener("appUrlOpen", ({ url }) => receive(url));
      if (cancelled) { await listener.remove(); return; }
      cleanup = () => { void listener.remove(); };
      const launch = await App.getLaunchUrl();
      if (!cancelled && launch) receive(launch.url);
    });
    return () => { cancelled = true; cleanup(); };
  }, [nativeApp]);
  const exitApp = async () => {
    setSharingRef.current(false);
    setStopped(true);
    setExitConfirm(false);
    if (isNativeApp()) { const { App } = await import("@capacitor/app"); await App.exitApp(); }
  };

  // Helyi adatok betöltése (csak a telefonon)
  useEffect(() => {
    setNativeApp(isNativeApp());
    setDeviceId(getDeviceId());
    const p = loadProfile();
    setProfile(p);
    setPrefs(loadPrefs());
    setRooms(loadRooms());
    invitationRepoRef.current = releaseRepository(window.location.hash);
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

  // A sötét/világos kapcsoló az egész felületre hat (panelek, ablakok, kapszulák, beállítások), nem csak a térképre.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = prefs.mapTheme;
    root.classList.toggle("dark", prefs.mapTheme === "dark");
    root.style.colorScheme = prefs.mapTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", prefs.mapTheme === "dark" ? "#12161f" : "#d9d1bf");
  }, [prefs.mapTheme]);

  const updatePrefs = (patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  };

  const askAddress = mounted && !stopped && dialog === null && prefs.addressConsent === "ask" && !addressAskHidden;
  useEffect(() => {
    if (!askAddress) return;
    const timer = setTimeout(() => setAddressAskHidden(true), 30000);
    return () => clearTimeout(timer);
  }, [askAddress]);

  const updateRooms = useCallback((fn: (prev: SavedRoom[]) => SavedRoom[]) => {
    setRooms((prev) => {
      const next = fn(prev);
      saveRooms(next);
      return next;
    });
  }, []);

  const onRoomClosed = useCallback(
    (token: string, reason: "closed" | "kicked") => {
      updateRooms((prev) => {
        const room = prev.find((r) => r.token === token);
        if (room && !room.owner) toast.info(reason === "kicked" ? `A létrehozó eltávolított a(z) „${room.name}” szobából.` : `A(z) „${room.name}” szobát a létrehozója törölte.`);
        return room && !room.owner ? removeRoom(prev, token) : prev;
      });
    },
    [updateRooms],
  );

  const sharingRef = useRef(prefs.sharing);
  sharingRef.current = prefs.sharing;
  const setSharingRef = useRef<(v: boolean) => void>(() => undefined);
  const onShareRequest = useCallback((dev: string) => {
    const who = netPeopleRef.current[dev]?.name ?? "Egy szobatársad";
    if (sharingRef.current) {
      toast.info(`${who} kérte a helyzetedet – a megosztás már be van kapcsolva.`);
      return;
    }
    toast(`${who} szeretné látni, merre vagy`, {
      description: "Egy koppintással bekapcsolhatod a megosztást.",
      duration: 15000,
      action: { label: "Megosztás", onClick: () => setSharingRef.current(true) },
    });
    void notifyShareRequest(who);
  }, []);
  const netPeopleRef = useRef<Record<string, RemotePerson>>({});

  const net = usePeerNetwork({ rooms, deviceId, profile: stopped ? null : profile, onRoomClosed, onShareRequest });
  netPeopleRef.current = net.people;

  // Saját GPS: mindig fut, privát; csak a megosztás kapcsoló küld a szobatársaknak.
  // Az Android-alkalmazásban bekapcsolt megosztásnál lezárt képernyőnél is folytatódik.
  const backgroundSharing = nativeApp && prefs.sharing;
  useEffect(() => {
    if (!mounted || !profile || stopped || !nativeStopReady || dialog === "welcome" || dialog === "permissions") return;
    setGpsStatus((s) => (s === "live" ? s : "waiting"));
    // Drift-szűrő: álló helyzetben a jelölő nem vándorol, a pontatlan hálózati fix nem ront a jó GPS-en.
    const driftFilter = createDriftFilter();
    return startLocationWatch({
      background: backgroundSharing,
      onFix: (rawFix) => {
        const fix = driftFilter(rawFix);
        const now = Date.now();
        const at = fix.at ?? now;
        const point = { lat: fix.lat, lng: fix.lng, t: at };
        selfTrackRef.current = appendTrackPoint(selfTrackRef.current, point, now);
        setSelfTrack(selfTrackRef.current);
        setSelfMeta({ speed: fix.speed, acc: fix.acc, at });
        selfMetaRef.current = { speed: fix.speed, acc: fix.acc, at };
        fixBearingRef.current = fix.bearing ?? headingFromTrack(selfTrackRef.current);
        headingRef.current = hybridHeading(headingRef.current, fix.speed, fixBearingRef.current, sensorRef.current);
        setSelfHeading(headingRef.current.angle);
        stopRef.current = updateStop(stopRef.current, point, fix.speed, fix.acc, at);
        transportRef.current = updateTransport(transportRef.current, fix.speed, at, manualRef.current);
        setTransport(transportRef.current.mode);
        setGpsStatus("live");
        if (!shouldPublishLocation(prefsRef.current.sharing, now, lastSentRef.current)) return;
        lastSentRef.current = now;
        publishRef.current();
      },
      onError: (err) => setGpsStatus(err),
      onNotificationsBlocked: () => {
        // Minden újraindításnál (pl. a háttérből visszatérve) ne ugorjon fel újra.
        if (notificationHintShown) return;
        notificationHintShown = true;
        toast("Az értesítések ki vannak kapcsolva", {
          description: "A megosztás fut, de a felső sávban nem látszik, és a telefon könnyebben leállíthatja.",
          duration: 12000,
          action: { label: "Bekapcsolás", onClick: () => void openPermissionSettings("notifications") },
        });
      },
      onPreciseMissing: () => {
        if (preciseHintShown) return;
        preciseHintShown = true;
        toast("Csak hozzávetőleges a helyzeted", {
          description: "A „Pontos hely” kapcsoló ki van kapcsolva, ezért a jelölőd akár több száz métert is tévedhet.",
          duration: 12000,
          action: { label: "Pontosítás", onClick: () => void requestPermission("location") },
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, profile !== null, stopped, nativeStopReady, gpsRequest, backgroundSharing, dialog === "permissions", dialog === "welcome"]);

  // Újraindítás a telefon beállításaiból vagy a háttérből visszatérve.
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === "visible") setGpsRequest((n) => n + 1);
    };
    let permission: PermissionStatus | undefined;
    let cancelled = false;
    if (!nativeApp && navigator.permissions) {
      void navigator.permissions.query({ name: "geolocation" }).then((p) => {
        if (cancelled) return;
        permission = p;
        p.addEventListener("change", resume);
      }).catch(() => undefined);
    }
    document.addEventListener("visibilitychange", resume);
    document.addEventListener("resume", resume);
    return () => {
      cancelled = true;
      permission?.removeEventListener("change", resume);
      document.removeEventListener("visibilitychange", resume);
      document.removeEventListener("resume", resume);
    };
  }, [nativeApp]);

  // Csatlakozási gond (pl. két szigorú mobilnet között) – egyszer jelezzük.
  const warnedIssueRef = useRef(false);
  useEffect(() => {
    if (net.connectIssues > 0 && !warnedIssueRef.current) {
      warnedIssueRef.current = true;
      toast.warning("Egy szobatársaddal nem sikerült közvetlen kapcsolatot létesíteni. Próbáljátok Wi-Fi-n, vagy egy kicsit később.");
    }
  }, [net.connectIssues]);

  const setSharing = (value: boolean) => {
    prefsRef.current = { ...prefsRef.current, sharing: value };
    sinceRef.current = value ? sinceRef.current ?? Date.now() : null;
    updatePrefs({ sharing: value });
    // Koppintásra azonnal kérjük az értesítés-engedélyt, hogy a felső sáv a bekapcsolás után rögtön látszódjon.
    if (value && nativeApp) void prepareSharing();
    if (!value) {
      prefsRef.current = { ...prefsRef.current, sharing: false };
      net.sendLocation(null);
      return;
    }
    const last = selfTrackRef.current[selfTrackRef.current.length - 1];
    if (last && Date.now() - last.t < 15000) {
      lastSentRef.current = Date.now();
      publishRef.current();
    }
  };
  setSharingRef.current = setSharing;

  const askToShare = (dev: string) => {
    const p = net.people[dev];
    if (!p?.online) {
      toast.info("Ő most nincs online, ezért nem tudod megkérni.");
      return;
    }
    if (net.requestShare(dev)) toast.success(`Kérés elküldve ${p.name} részére.`);
  };

  const remote = useMemo(
    () =>
      Object.values(net.people).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, "hu")),
    [net.people],
  );

  const mapPeople: MapPerson[] = useMemo(() => {
    const list: MapPerson[] = [];
    if (profile && selfTrack.length)
      list.push({ id: SELF, name: profile.name, avatarUrl: profile.avatar, color: SELF_COLOR, points: selfTrack, isSelf: true, heading: selfHeading, battery, stoppedSince: stopRef.current?.since ?? null, speed: selfMeta?.speed ?? null });
    for (const p of remote) {
      if (p.sharing && p.points.length)
        list.push({ id: p.deviceId, name: p.name, avatarUrl: p.avatar, color: p.color, points: p.points, heading: p.heading, battery: p.battery, stoppedSince: p.stoppedSince, speed: p.speed });
    }
    return list;
  }, [profile, selfTrack, remote, selfHeading, battery, selfMeta]);

  const trailPeople = useMemo(() => [{ id: SELF, name: "Én" }, ...remote.map((p) => ({ id: p.deviceId, name: p.name }))], [remote]);
  const trailChecked = (id: string) => prefs.showTrails || prefs.trailIds.includes(id);
  const setAllTrails = (on: boolean) => updatePrefs({ showTrails: on, trailIds: [] });
  const setPersonTrail = (id: string, on: boolean) => {
    const all = trailPeople.map((p) => p.id);
    const current = prefs.showTrails ? all : prefs.trailIds;
    const next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
    if (all.every((x) => next.includes(x))) updatePrefs({ showTrails: true, trailIds: [] });
    else updatePrefs({ showTrails: false, trailIds: next });
  };
  const clearPersonTrail = (id: string, name: string) => {
    if (id === SELF) {
      selfTrackRef.current = clearTrackHistory(selfTrackRef.current);
      setSelfTrack(selfTrackRef.current);
    } else net.clearTrail(id);
    toast.success(`${name} útvonala törölve erről a telefonról.`);
  };

  const hasPosition = (id: string) => mapPeople.some((p) => p.id === id);

  const toggleFollow = (id: string) => {
    if (follow?.id === id) {
      setFollow(null);
      return;
    }
    if (!hasPosition(id)) {
      if (id === SELF) {
        if (gpsStatus === "denied") setDialog("permissions");
        else { setGpsRequest((n) => n + 1); toast.info("Újra keresem a helyzetedet. Ellenőrizd, hogy a telefon helymeghatározása be van-e kapcsolva."); }
      }
      else
        toast(`${net.people[id]?.name ?? "Ő"} most nem osztja meg a helyzetét`, {
          action: { label: "Kérés", onClick: () => askToShare(id) },
        });
      return;
    }
    setFollow((prev) => ({ id, request: (prev?.request ?? 0) + 1 }));
  };

  const toggleOrientation = () => {
    void requestCompassPermission().catch(() => false);
    const next: Orientation = prefs.orientation === "north" ? "heading" : "north";
    updatePrefs({ orientation: next });
    if (next === "heading" && !follow && hasPosition(SELF)) setFollow((prev) => ({ id: SELF, request: (prev?.request ?? 0) + 1 }));
  };

  const createRoom = async () => {
    let authority;
    try {
      authority = await createRoomAuthority();
    } catch {
      toast.error("A szoba létrehozása nem sikerült. Próbáld újra.");
      return;
    }
    const token = generateRoomToken();
    const owned = rooms.filter((r) => r.owner).length;
    updateRooms((prev) => addRoom(prev, { token, name: owned ? `Szobám ${owned + 1}` : "Szobám", owner: true, createdAt: Date.now(), color: DEFAULT_ROOM_COLOR, ...authority }));
    setShareToken(token);
    setDialog("share");
  };

  const joinRoom = (token: string, name: string | null, color?: RoomColor, ownerKey?: string) => {
    if (rooms.some((r) => r.token === token)) {
      toast.info("Ebben a szobában már benne vagy.");
    } else {
      updateRooms((prev) => addRoom(prev, { token, name: name || "Meghívott szoba", owner: false, createdAt: Date.now(), color: color ?? DEFAULT_ROOM_COLOR, ...(ownerKey ? { ownerKey } : {}) }));
      toast.success("Csatlakoztál. Amint a többiek is online vannak, látjátok egymást.");
    }
    setPendingJoin(null);
    setDialog(null);
  };

  const deleteRoom = async (room: SavedRoom) => {
    if (room.owner && room.ownerKey && room.ownerPrivateKey) {
      try {
        const control = await signRoomControl(room.token, { ownerKey: room.ownerKey, ownerPrivateKey: room.ownerPrivateKey }, "close", null);
        await net.sendControl(control);
      } catch {
        toast.error("A szoba törlése nem sikerült. Próbáld újra.");
        return;
      }
    }
    updateRooms((prev) => removeRoom(prev, room.token));
    toast.success(room.owner ? room.ownerPrivateKey ? "A szoba törölve." : "A régi szobát eltávolítottam erről a készülékről." : "Kiléptél a szobából.");
  };

  const kickPerson = async (room: SavedRoom, person: RemotePerson) => {
    if (!room.owner || !room.ownerKey || !room.ownerPrivateKey || !window.confirm(`Biztosan eltávolítod ${person.name}-t a szobából?`)) return;
    try { await net.sendControl(await signRoomControl(room.token, { ownerKey: room.ownerKey, ownerPrivateKey: room.ownerPrivateKey }, "kick", person.deviceId)); }
    catch { toast.error("Az eltávolítás nem sikerült."); }
  };
  const onlineCount = remote.filter((p) => p.online).length;
  const viewers = prefs.sharing ? remote.filter((p) => p.online) : [];
  const selfFresh = selfMeta ? clock - selfMeta.at < 15000 : false;

  const sharingStatus: SharingStatus = !prefs.sharing ? "off" : gpsStatus === "error" || gpsStatus === "denied" ? "lost" : !selfFresh ? "search" : "live";
  const windowRef = useRef<HTMLElement | null>(null);
  const mirrorRef = useRef<HTMLCanvasElement | null>(null);
  const [win, setWin] = useState<MapWindow | null>(null);
  useEffect(() => {
    const el = windowRef.current;
    const shell = el?.parentElement;
    if (!el || !shell) {
      setWin(null);
      return;
    }
    const update = () => {
      const r = el.getBoundingClientRect();
      const sh = shell.getBoundingClientRect();
      const next: MapWindow = {
        x: Math.round(r.left - sh.left),
        y: Math.round(r.top - sh.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
        vw: Math.round(sh.width),
        vh: Math.round(sh.height),
        radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
      };
      setWin((prev) => (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h && prev.vw === next.vw && prev.vh === next.vh && prev.radius === next.radius ? prev : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    Array.from(shell.children).forEach((child) => observer.observe(child));
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [mounted, stopped]);
  const mapPadding = useMemo(
    () => (win ? { top: win.y, left: win.x, right: Math.max(0, win.vw - win.x - win.w), bottom: Math.max(0, win.vh - win.y - win.h) } : undefined),
    [win],
  );

  if (stopped) return <div className="map-workspace glass-shell items-center justify-center gap-4"><h1 className="font-display text-lg">Private Place</h1><p className="text-sm text-muted-foreground">A helymegosztás leállítva.</p><Button onClick={() => setStopped(false)}><Play />Vissza a térképhez</Button></div>;
  if (!mounted) return <div className="map-workspace glass-shell" />;

  return (
    <div
      className="map-workspace glass-shell"
      style={mapPadding ? ({ "--win-r": `${mapPadding.right}px`, "--win-b": `${mapPadding.bottom}px` } as CSSProperties) : undefined}
    >
      <div className="map-bg">
        <Suspense fallback={<div className="h-full" />}>
          <LiveMap
            people={mapPeople}
            follow={follow}
            showTrails={prefs.showTrails}
            trailIds={prefs.trailIds}
            orientation={prefs.orientation}
            theme={prefs.mapTheme}
            onUserPan={() => setFollow(null)}
            compassRef={compassRef}
            addressAllowed={addressAllowed}
            onAllowAddress={() => updatePrefs({ addressConsent: "yes" })}
            padding={mapPadding}
            mirrorRef={mirrorRef}
          />
        </Suspense>
      </div>
      <div className="map-veil" style={win ? veilStyle(win) : { visibility: "hidden" }} aria-hidden="true">
        <canvas ref={mirrorRef} className="map-mirror" />
      </div>
      <header className="glass z-10 flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-base font-bold">Private Place</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <SharingControl status={sharingStatus} onToggle={() => setSharing(!prefs.sharing)} />
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

      <main ref={windowRef} className="map-panel min-h-0 flex-1" aria-label="Térkép">
        {askAddress && (
          <div className="map-overlay glass address-ask" role="group" aria-label="Címlekérés engedélye">
            <span className="address-ask-text">Cím megjelenítése?</span>
            <Button size="sm" variant="ghost" className="h-8 rounded-full px-3 text-xs" onClick={() => updatePrefs({ addressConsent: "no" })}>Nem</Button>
            <Button size="sm" variant="ghost" className="indicator h-8 rounded-full px-3 text-xs" data-state="on" onClick={() => updatePrefs({ addressConsent: "yes" })}>Igen</Button>
          </div>
        )}
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

        <Button size="icon" variant="ghost" className="map-overlay glass compass-btn absolute right-3 top-16"
          aria-label={prefs.mapTheme === "dark" ? "Váltás világos módra" : "Váltás sötét módra"}
          title={prefs.mapTheme === "dark" ? "Világos mód" : "Sötét mód"}
          onClick={() => updatePrefs({ mapTheme: prefs.mapTheme === "dark" ? "light" : "dark" })}>
          {prefs.mapTheme === "dark" ? <Sun /> : <Moon />}
        </Button>

        <TransportControl key={follow?.id ?? SELF} mode={follow && follow.id !== SELF ? net.people[follow.id]?.transport ?? null : transport} own={!follow || follow.id === SELF} manual={manualTransport !== null} onSelect={mode => {
          manualRef.current = mode; setManualTransport(mode);
          if (mode) { transportRef.current = { mode, candidate: null, candidateAt: Date.now() }; setTransport(mode); }
          publishRef.current();
        }} />
      </main>

      <section className="people-rail-wrap shrink-0" aria-label="Én és a szobatársaim">
        <div ref={railRef} className="people-rail">
          <div className="people-track">
            {profile && (
              <PersonCapsule
                name="Én"
                avatar={profile.avatar}
                fallback={profile.name}
                color={SELF_COLOR}
                active={follow?.id === SELF}
                dot={selfFresh ? "on" : gpsStatus === "denied" || gpsStatus === "error" ? "warn" : "wait"}
                status={selfMeta ? kmh(selfMeta.speed) : ""}
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
                dot={!p.online ? "warn" : !p.sharing ? "off" : p.at && clock - p.at < 15000 ? "on" : "wait"}
                status={personStatus(p)}
                onClick={() => toggleFollow(p.deviceId)}
              />
            ))}
            {remote.length === 0 && (
              <button className="capsule capsule-invite" onClick={() => setDialog("rooms")}>
                <span className="capsule-avatar capsule-avatar-plus">
                  <Plus className="h-6 w-6" />
                </span>
                <span className="flex min-w-0 flex-col items-start text-left">
                  <span className="w-full truncate text-sm font-semibold">Meghívó</span>
                  <span className="w-full truncate text-[11px] text-muted-foreground">Szoba</span>
                </span>
              </button>
            )}
          </div>
        </div>
      </section>

      {profile && dialog === null && <HintBubbles key={hintsKey} />}

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && dialog === "welcome") { setExitConfirm(true); return; }
          if (!open && dialog !== "welcome") {
            setDialog(null);
            setPendingJoin(null);
          }
        }}
      >
        <DialogContent
          className={`glass-dialog w-[calc(100%-1.5rem)] max-w-[390px] max-h-[94dvh] overflow-hidden gap-0 p-0${dialog === "settings" || dialog === "rooms" || dialog === "share" ? " compact-panel flex h-[min(94dvh,760px)] max-h-[94dvh] flex-col" : ""}`}
          onInteractOutside={(e) => dialog === "welcome" && e.preventDefault()}
          onEscapeKeyDown={(e) => dialog === "welcome" && e.preventDefault()}
        >
          {exitConfirm && dialog === "welcome" && <><PanelHeader title="Kilépsz az alkalmazásból?" description="A helymegosztás leáll. A térkép használatához meg kell adnod a nevedet." /><div className="flex justify-end gap-2 p-5"><Button variant="outline" onClick={() => setExitConfirm(false)}>Mégsem</Button><Button variant="destructive" onClick={() => void exitApp()}><LogOut />Kilépés</Button></div></>}
          {dialog === "welcome" && !exitConfirm && (
            <ProfileForm
              title="Üdv a Private Place-ben"
              description="Nincs regisztráció és nincs jelszó. A neved és a képed csak ezen a telefonon tárolódik, és csak a szobatársaid látják."
              initial={null}
              submitLabel="Kezdés"
              onSave={(p) => {
                saveProfile(p);
                setProfile(p);
                setDialog(permissionsAsked() ? (pendingJoin ? "join" : null) : "permissions");
              }}
            />
          )}

          {dialog === "permissions" && (
            <PermissionsPanel
              native={nativeApp}
              addressConsent={prefs.addressConsent}
              onAddressConsent={(v) => updatePrefs({ addressConsent: v ? "yes" : "no" })}
              onAskAddressAgain={() => { updatePrefs({ addressConsent: "ask" }); setAddressAskHidden(false); setDialog(null); }}
              onDone={() => {
                markPermissionsAsked();
                setGpsRequest((n) => n + 1);
                setDialog(pendingJoin ? "join" : null);
              }}
            />
          )}

          {dialog === "viewers" && (
            <>
              <PanelHeader
                title="Ki látja a helyzetemet?"
                description="Csak a szobáidban éppen kapcsolódó emberek, és csak amíg a megosztás be van kapcsolva."
              />
              <div className="space-y-3 px-5 pb-5">
                <div className="glass-inset flex items-center justify-between gap-3 rounded-2xl p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="status-dot" data-state={prefs.sharing ? "on" : "off"} />
                    <span className="text-sm font-semibold">{prefs.sharing ? "Megosztás bekapcsolva" : "Megosztás kikapcsolva"}</span>
                  </div>
                  <Button
                    size="sm"
                    variant={prefs.sharing ? "outline" : "default"}
                    className={prefs.sharing ? "glass-button rounded-full" : "rounded-full"}
                    onClick={() => setSharing(!prefs.sharing)}
                  >
                    {prefs.sharing ? <Pause className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
                    {prefs.sharing ? "Leállítás" : "Indítás"}
                  </Button>
                </div>
                <ElasticScroll className="max-h-[40dvh]">
                  <div className="space-y-2">
                    {viewers.length === 0 && (
                      <p className="glass-inset rounded-2xl p-4 text-sm text-muted-foreground">
                        {prefs.sharing ? "Most senki nem kapcsolódik a szobáidban, így senki nem lát." : "Senki nem látja a helyzetedet."}
                      </p>
                    )}
                    {viewers.map((p) => (
                      <div key={p.deviceId} className="glass-inset flex items-center gap-3 rounded-2xl p-2.5">
                        <span className="capsule-avatar viewer-avatar" style={{ "--person-color": p.color } as React.CSSProperties}>
                          {p.avatar ? <img src={p.avatar} alt="" /> : p.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span>
                        <span className="status-dot mr-2" data-state="on" />
                      </div>
                    ))}
                  </div>
                </ElasticScroll>
                <p className="text-xs text-muted-foreground">Ha valakit ki akarsz zárni, töröld vagy hagyd el a közös szobát a Szobák menüben.</p>
              </div>
            </>
          )}

          {dialog === "join" && <JoinPanel initial={pendingJoin} repository={invitationRepoRef.current} onJoin={joinRoom} onReject={() => { setPendingJoin(null); setDialog(null); }} />}

          {dialog === "share" && shareToken && (
            <SharePanel room={rooms.find((r) => r.token === shareToken) ?? null} onDone={() => setDialog("rooms")} />
          )}

          {dialog === "rooms" && (
            <>
              <PanelHeader compact title="Szobák" description="Csak az lát téged, akinek elküldöd a szobád kódját vagy QR-kódját." />
              <ElasticScroll className="min-h-0 flex-1 px-4 pt-4">
                <div className="space-y-2.5 pb-2">
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
                      members={(net.roomMembers[room.token] ?? []).map(id => net.people[id]).filter((p): p is RemotePerson => Boolean(p))}
                      onKick={p => void kickPerson(room, p)}
                      onShare={() => {
                        setShareToken(room.token);
                        setDialog("share");
                      }}
                      onDelete={() => void deleteRoom(room)}
                      onSave={(name, color) => updateRooms((prev) => customizeRoom(prev, room.token, name, color))}
                    />
                  ))}
                </div>
              </ElasticScroll>
              <div className="grid shrink-0 grid-cols-2 gap-2 p-4 pt-3">
                <Button size="sm" className="rounded-full" onClick={() => void createRoom()}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Új szoba
                </Button>
                <Button size="sm" variant="outline" className="glass-button rounded-full" onClick={() => setDialog("join")}>
                  <DoorOpen className="mr-1.5 h-4 w-4" />
                  Csatlakozás
                </Button>
              </div>
            </>
          )}

          {dialog === "settings" && profile && settingsView === "main" && (
            <>
              <PanelHeader compact title="Beállítások" />
              <ElasticScroll className="min-h-0 flex-1 px-4 pb-4 pt-4">
                <div className="space-y-2.5">
                  <div className="glass-inset rounded-2xl p-3">
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

                  <Button size="sm" variant="outline" className="glass-button w-full justify-between rounded-full" onClick={() => setSettingsView("trails")}>
                    Útvonalak rajzolása a térképen
                    <ChevronRight className="h-4 w-4" />
                  </Button>

                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" className="glass-button rounded-full" onClick={() => setDialog("permissions")}>
                      <ShieldCheck className="mr-1.5 h-4 w-4" />
                      Engedélyek
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="glass-button rounded-full"
                      onClick={() => {
                        resetHints();
                        setHintsKey((n) => n + 1);
                        setDialog(null);
                      }}
                    >
                      <HelpCircle className="mr-1.5 h-4 w-4" />
                      Súgó
                    </Button>
                  </div>

                  <p className="text-center text-[11px] text-muted-foreground">
                    Private Place · {(import.meta.env["VITE_APP_VERSION"] as string | undefined) || "webes változat"}
                  </p>
                </div>
              </ElasticScroll>
            </>
          )}

          {dialog === "settings" && profile && settingsView === "trails" && (
            <>
              <DialogHeader className="shrink-0 flex-row items-center space-y-0 gap-1 p-3 pb-2 pr-12 text-left">
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" aria-label="Vissza" onClick={() => setSettingsView("main")}>
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <DialogTitle className="font-display text-base">Útvonalak</DialogTitle>
                <DialogDescription className="sr-only">Kiválaszthatod, kinek az útvonala jelenjen meg a térképen, és törölheted az útvonalakat.</DialogDescription>
              </DialogHeader>
              <ElasticScroll className="min-h-0 flex-1 px-4 pb-4 pt-4">
                <div className="glass-inset space-y-1 rounded-2xl p-3">
                  <label className="flex items-center gap-3 pb-2 text-sm font-semibold">
                    <Checkbox checked={prefs.showTrails} onCheckedChange={(v) => setAllTrails(v === true)} />
                    Összes személy
                  </label>
                  {trailPeople.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 border-t border-foreground/10 py-1">
                      <label className="flex min-w-0 flex-1 items-center gap-3 text-sm">
                        <Checkbox checked={trailChecked(p.id)} onCheckedChange={(v) => setPersonTrail(p.id, v === true)} />
                        <span className="truncate">{p.name}</span>
                      </label>
                      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" aria-label={`${p.name} útvonalának törlése`} title="Útvonal törlése" onClick={() => clearPersonTrail(p.id, p.name)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ElasticScroll>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const HINTS_KEY = "privateplace.hints.v1";
const HINTS: { text: string; place: string }[] = [
  { text: "Ezzel a gombbal egy koppintással indítod vagy leállítod a megosztást. Akkut kímél, ha leállítod.", place: "hint-share" },
  { text: "Itt látod, hogyan közlekedsz (gyalog, kerékpárral vagy autóval). A tempód alapján magától vált, de rábökve te is kiválaszthatod.", place: "hint-transport" },
  { text: "Koppints egy személyre a követéshez. Ha nem oszt meg, innen kérheted meg rá.", place: "hint-rail" },
  { text: "Ha valaki megosztást kér, felül üzenet jelenik meg – a „Megosztás” gombbal azonnal bekapcsolod.", place: "hint-share" },
];

function resetHints() {
  try {
    localStorage.removeItem(HINTS_KEY);
  } catch {
    /* nem kritikus */
  }
}

/** Rövid, üveges súgóbuborékok első használatkor (a Beállítások → Súgó gombbal újra). */
function HintBubbles() {
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    try {
      setStep(Number(localStorage.getItem(HINTS_KEY) ?? "0") || 0);
    } catch {
      setStep(HINTS.length);
    }
  }, []);
  const demoActive = step !== null && HINTS[step]?.place === "hint-transport";
  useEffect(() => {
    if (!demoActive) return;
    const emit = (v: boolean) => window.dispatchEvent(new CustomEvent(TRANSPORT_DEMO_EVENT, { detail: v }));
    let t: ReturnType<typeof setTimeout>;
    const cycle = () => { t = setTimeout(() => { emit(true); t = setTimeout(() => { emit(false); cycle(); }, 1000); }, 750); };
    cycle();
    return () => { clearTimeout(t); emit(false); };
  }, [demoActive]);
  if (step === null || step >= HINTS.length) return null;
  const hint = HINTS[step];
  if (!hint) return null;
  const next = (to: number) => {
    setStep(to);
    try {
      localStorage.setItem(HINTS_KEY, String(to));
    } catch {
      /* nem kritikus */
    }
  };
  return (
    <div className={`hint-bubble glass ${hint.place}`} role="status">
      <p className="text-xs leading-snug">{hint.text}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button className="text-[11px] text-muted-foreground underline underline-offset-2" onClick={() => next(HINTS.length)}>
          Kihagyás
        </button>
        <button className="hint-next" onClick={() => next(step + 1)}>
          {step + 1 < HINTS.length ? `Tovább ${step + 1}/${HINTS.length}` : "Értem"}
        </button>
      </div>
    </div>
  );
}

/** Ha az app a háttérben fut (pl. zsebben), rendszerértesítés is jelzi a kérést. */
async function notifyShareRequest(who: string) {
  if (!isNativeApp() || document.visibilityState === "visible") return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.schedule({
      notifications: [{ id: Math.floor(Date.now() % 2_000_000_000), title: "Helymegosztást kértek", body: `${who} szeretné látni, merre vagy.` }],
    });
  } catch {
    /* értesítés nem engedélyezett */
  }
}

const PERM_INFO: Record<PermKey, { label: string; hint: string; icon: React.ComponentType<{ className?: string }> }> = {
  location: { label: "Pontos helyzet", hint: "A saját pozíciód a térképen. A rendszerablakban válaszd a „Pontos” lehetőséget.", icon: MapPin },
  backgroundLocation: {
    label: "Helyzet lezárt képernyőnél",
    hint: "A megnyíló beállításokban: Engedélyek → Hely → Mindig engedélyezés.",
    icon: LockKeyhole,
  },
  notifications: { label: "Értesítések", hint: "Jelzi, ha a megosztás a háttérben is fut.", icon: Bell },
  camera: { label: "Kamera", hint: "A szobák QR-kódjának beolvasásához.", icon: Camera },
  battery: {
    label: "Akkumulátor-kímélés kikapcsolása",
    hint: "Hogy a telefon ne állítsa le a megosztást, amíg zsebben van.",
    icon: BatteryCharging,
  },
};

function PermissionsPanel({ native, onDone, addressConsent, onAddressConsent, onAskAddressAgain }: { native: boolean; onDone: () => void; addressConsent: Prefs["addressConsent"]; onAddressConsent: (allowed: boolean) => void; onAskAddressAgain: () => void }) {
  const keys = permissionKeys(native);
  const [states, setStates] = useState<Partial<PermMap>>({});
  const [busy, setBusy] = useState<PermKey | "all" | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);

  const refresh = useCallback(async () => setStates(await checkAllPermissions()), []);
  useEffect(() => {
    void refresh();
    const onBack = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onBack);
    document.addEventListener("resume", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      document.removeEventListener("resume", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [refresh]);

  const set = (key: PermKey, state: PermState) => setStates((prev) => ({ ...prev, [key]: state }));

  const askOne = async (key: PermKey) => {
    setBusy(key);
    try {
      if (states[key] === "denied" && native) await openPermissionSettings(key);
      else set(key, await requestPermission(key));
    } finally {
      setBusy(null);
    }
  };

  const askAll = async () => {
    setBusy("all");
    try {
      await requestAllPermissions(set);
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const allGranted = keys.every((k) => states[k] === "granted" || states[k] === "manual");

  return (
    <>
      <PanelHeader
        title="Engedélyek"
        description="Hogy a Private Place rendesen működjön, ezekhez kér hozzáférést. Semmi nem kerül központi helyre."
      />
      <ElasticScroll className="max-h-[52dvh] px-5">
        <div className="space-y-2.5 pb-1">
          {keys.map((key) => {
            const info = PERM_INFO[key];
            const Icon = info.icon;
            const state = states[key];
            const granted = state === "granted";
            const denied = state === "denied";
            return (
              <div key={key} className="glass-inset flex items-center gap-3 rounded-2xl p-3">
                <span className="indicator grid h-10 w-10 shrink-0 place-items-center rounded-full" data-state={granted ? "on" : "off"}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{info.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {denied && !native
                      ? "Elutasítva – a böngésző címsoránál engedélyezheted."
                      : state === "limited"
                        ? "Most csak hozzávetőleges. Koppints a Pontosításra, és kapcsold be a „Pontos hely”-et."
                        : info.hint}
                  </p>
                </div>
                {granted ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="status-dot" data-state="on" />
                    Kész
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant={denied ? "outline" : "default"}
                    className={denied ? "glass-button shrink-0 rounded-full" : "shrink-0 rounded-full"}
                    disabled={busy !== null || (denied && !native)}
                    onClick={() => void askOne(key)}
                  >
                    {state === "limited"
                      ? "Pontosítás"
                      : state === "manual" || (denied && native)
                        ? "Beállítás"
                        : denied
                          ? "Elutasítva"
                          : "Engedélyezés"}
                  </Button>
                )}
              </div>
            );
          })}
          <div className="glass-inset space-y-1 rounded-2xl p-3">
            <label className="flex items-center gap-3 text-sm">
              <Checkbox checked={addressConsent === "yes"} onCheckedChange={(v) => onAddressConsent(v === true)} />
              Pontos cím lekérése (OpenStreetMap)
            </label>
            <Button size="sm" variant="ghost" className="h-8 rounded-full px-3 text-xs" onClick={onAskAddressAgain}>
              Címkérdés újra megjelenítése
            </Button>
          </div>
        </div>
      </ElasticScroll>
      {native && (
        <div className="px-5 pb-1 text-center">
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline underline-offset-2"
            onClick={() => {
              setDiagnostics("Mérés…");
              void permissionDiagnostics().then(setDiagnostics);
            }}
          >
            Diagnosztika
          </button>
          {diagnostics && <pre className="mt-2 max-h-40 select-text overflow-auto whitespace-pre-wrap break-words rounded-xl bg-foreground/10 p-3 text-left text-[10px] leading-snug">{diagnostics}</pre>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 p-5 pt-4">
        <Button className="rounded-full" disabled={busy !== null || allGranted} onClick={() => void askAll()}>
          <ShieldCheck className="mr-1.5 h-4 w-4" />
          {busy === "all" ? "Kérés…" : "Összes engedélyezése"}
        </Button>
        <Button variant="outline" className="glass-button rounded-full" disabled={busy === "all"} onClick={onDone}>
          {allGranted ? "Kész" : "Tovább"}
        </Button>
      </div>
    </>
  );
}

function PanelHeader({ title, description, compact }: { title: string; description?: string; compact?: boolean }) {
  return (
    <DialogHeader className={compact ? "shrink-0 space-y-0.5 p-4 pb-2 pr-12 text-left" : "p-5 pb-4 pr-12 text-left"}>
      <DialogTitle className={compact ? "font-display text-base" : "font-display text-lg"}>{title}</DialogTitle>
      <DialogDescription className={description ? (compact ? "text-xs" : undefined) : "sr-only"}>{description || title}</DialogDescription>
    </DialogHeader>
  );
}

function PersonCapsule(props: {
  name: string;
  avatar: string | null;
  fallback: string;
  color: string;
  active: boolean;
  dot: "on" | "off" | "warn" | "wait";
  status: string;
  onClick: () => void;
}) {
  return (
    <Button variant="ghost"
      className="capsule indicator"
      data-state={props.active ? "on" : "off"}
      aria-pressed={props.active}
      aria-label={`${props.name} – ${props.active ? "követés kikapcsolása" : "követés"}`}
      onClick={props.onClick}
    >
      <span className="capsule-avatar" style={{ "--person-color": props.color } as React.CSSProperties}>
        {props.avatar ? <img src={props.avatar} alt="" /> : (props.fallback || "?").charAt(0).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-col items-start text-left">
        <span className="w-full truncate text-sm font-semibold">{props.name}</span>
        {props.status && <span className="w-full truncate text-[11px] text-muted-foreground">{props.status}</span>}
        <span className="status-dot mt-1" data-state={props.dot} />
      </span>
    </Button>
  );
}

function RoomRow({ room, peers, members, onKick, onShare, onDelete, onSave }: { room: SavedRoom; peers: number; members: RemotePerson[]; onKick: (person: RemotePerson) => void; onShare: () => void; onDelete: () => void; onSave: (name: string, color: RoomColor) => void }) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(room.name);
  const [color, setColor] = useState<RoomColor>(room.color ?? DEFAULT_ROOM_COLOR);
  const [confirm, setConfirm] = useState(false);
  return <div className="room-row glass-inset rounded-lg p-3">
    <div className="flex items-center gap-3">
      <Button variant="ghost" className={`room-name-circle room-${room.color ?? DEFAULT_ROOM_COLOR}`} aria-label={`Szoba szerkesztése: ${room.name}`} onClick={() => { setName(room.name); setColor(room.color ?? DEFAULT_ROOM_COLOR); setEditing(v => !v); }}><span>{room.name}</span></Button>
      <Button variant="ghost" className="flex-1 h-20" aria-label={`Szoba megnyitása: ${room.name}`} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}><ChevronDown className={expanded ? "rotate-180 transition-transform" : "transition-transform"} /></Button>
      <Button variant="ghost" size="icon" className="h-14 w-14 rounded-full" aria-label={`QR-kód: ${room.name}`} onClick={onShare}><QrCode className="h-8 w-8" /></Button>
    </div>
    {editing && <form className="mt-3 space-y-3 border-t border-border pt-3" onSubmit={e => { e.preventDefault(); if (name.trim()) { onSave(name, color); setEditing(false); } }}>
      <Input aria-label="Szoba neve" value={name} maxLength={40} onChange={e => setName(e.target.value)} />
      <div className="grid grid-cols-5 gap-2">{ROOM_COLORS.map(c => <Button key={c} type="button" variant="ghost" size="icon" className={`room-choice room-${c}`} aria-label={ROOM_COLOR_NAMES[c]} aria-pressed={color === c} onClick={() => setColor(c)}><span className="room-swatch">{color === c && <Check className="h-3 w-3" />}</span></Button>)}</div>
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="icon" aria-label="Szerkesztés elvetése" onClick={() => setEditing(false)}><X /></Button><Button type="submit" disabled={!name.trim()}><Check />Mentés</Button></div>
    </form>}
    <div className="room-expansion" data-open={expanded}><div className="min-h-0 overflow-hidden">
      <div className="flex justify-between items-center border-t border-border mt-3 pt-2"><span className="text-xs text-muted-foreground">{peers} kapcsolódva</span><Button variant="ghost" size="icon" className="text-destructive rounded-full" aria-label={room.owner ? `Szoba törlése: ${room.name}` : `Kilépés: ${room.name}`} onClick={() => setConfirm(true)}>{room.owner ? <Trash2 /> : <LogOut />}</Button></div>
      <ElasticScroll className="max-h-44"><div className="space-y-2 py-2">{members.map(p => <div key={p.deviceId} className="flex items-center gap-2"><span className="capsule-avatar viewer-avatar" style={{ "--person-color": p.color } as React.CSSProperties}>{p.avatar ? <img src={p.avatar} alt="" /> : p.name.charAt(0)}</span><span className="text-sm flex-1 min-w-0 truncate">{p.name}</span><span className="status-dot" data-state={p.online ? "on" : "off"} />{room.owner && room.ownerPrivateKey && <Button variant="ghost" size="icon" aria-label={`Eltávolítás: ${p.name}`} onClick={() => onKick(p)}><X /></Button>}</div>)}</div></ElasticScroll>
      {confirm && <div className="space-y-2"><p className="text-xs text-muted-foreground">{room.owner ? "Törlöd a szobát? A jelenleg kapcsolódó tagok értesülnek a törlésről." : "Kilépsz a szobából?"}</p><div className="flex gap-2"><Button size="sm" variant="destructive" onClick={onDelete}>{room.owner ? "Törlés" : "Kilépés"}</Button><Button size="sm" variant="outline" onClick={() => setConfirm(false)}>Mégsem</Button></div></div>}
    </div></div>
  </div>;
}

const ROOM_COLOR_NAMES: Record<RoomColor, string> = { mint: "Menta Zöld", violet: "Elektromos Levendula", rose: "Selyem Barack", amber: "Napfény Citromsárga", sky: "Jégkék" };

function SharePanel({ room, onDone }: { room: SavedRoom | null; onDone: () => void }) {
  const [qrColor, setQrColor] = useState<string>();
  const [qrBackground, setQrBackground] = useState<string>();

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    setQrColor(css.getPropertyValue(`--room-${room?.color ?? DEFAULT_ROOM_COLOR}`).trim());
    setQrBackground(css.getPropertyValue("--qr-background").trim());
  }, [room?.color]);

  if (!room) return null;

  const base = shareBase();
  const repo = releaseRepository();
  const rawLink = base
    ? buildRoomLink(base, room.token, room.name, room.color ?? DEFAULT_ROOM_COLOR, room.ownerKey)
    : null;
  const link = rawLink && repo ? `${rawLink}&forras=${encodeURIComponent(repo)}` : rawLink;
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
      await navigator.share({
        title: "Private Place meghívó",
        text: link ? "Csatlakozz a szobámhoz:" : `Szobakód: ${code}`,
        ...(link ? { url: link } : {}),
      });
    } catch {
      /* a felhasználó bezárta */
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <DialogHeader className="shrink-0 flex-row items-center space-y-0 gap-1 px-3 pt-3 pb-1 pr-12 text-left">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 rounded-full"
          aria-label="Vissza a szobákhoz"
          onClick={onDone}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <DialogTitle className="truncate font-display text-base">
          {room.name}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Csak az látja a helyzetedet, akinek ezt elküldöd.
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-col items-center gap-2 px-4 pb-3 pt-2">
        {/* QR-kód */}
        <div
          className="qr-frame mx-auto w-full shrink-0"
          style={{
            width: "min(100%, 210px)",
            padding: 6,
          }}
        >
          {qrBackground && qrColor && (
            <QRCodeSVG
              value={text}
              size={210}
              level="M"
              bgColor={qrBackground}
              fgColor={qrColor}
              marginSize={0}
              style={{
                display: "block",
                width: "100%",
                height: "auto",
              }}
            />
          )}
        </div>

        {/* Szobakód */}
        <div className="glass-inset w-full shrink-0 rounded-2xl px-3 py-1.5 text-center">
          <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Szobakód
          </p>
          <p className="font-display text-sm font-bold tracking-wider">
            {code}
          </p>
        </div>

        {/* Műveletek */}
        <div className="grid w-full shrink-0 grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="outline"
            className="glass-button h-9 rounded-full"
            onClick={() => void copy()}
          >
            <Copy className="mr-1.5 h-4 w-4" />
            {link ? "Link" : "Kód"} másolása
          </Button>

          {"share" in navigator ? (
            <Button
              size="sm"
              className="h-9 rounded-full"
              onClick={() => void share()}
            >
              <Share2 className="mr-1.5 h-4 w-4" />
              Küldés
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-9 rounded-full"
              onClick={onDone}
            >
              Kész
            </Button>
          )}
        </div>

        <p className="shrink-0 text-center text-[10px] leading-tight text-muted-foreground">
          Csak az látja a helyzetedet, akinek ezt elküldöd.
          Bármikor törölheted a szobát.
        </p>
      </div>
    </div>
  );
}

function JoinPanel({ initial, repository, onJoin, onReject }: { initial: { token: string; name: string | null; color?: RoomColor; ownerKey?: string } | null; repository: string | null; onJoin: (token: string, name: string | null, color?: RoomColor, ownerKey?: string) => void; onReject: () => void }) {
  const [value, setValue] = useState(initial ? formatRoomToken(initial.token) : "");
  const [scanning, setScanning] = useState(false);
  const [appTry, setAppTry] = useState<"idle" | "opening" | "missing">("idle");
  const parsed = parseRoomInput(value);
  const name = parsed?.name ?? initial?.name ?? null;
  const [release, setRelease] = useState<AppRelease | null>(null);
  useEffect(() => {
    const repo = repository ?? releaseRepository(window.location.hash);
    if (!repo) return;
    const controller = new AbortController();
    void latestRelease(repo, controller.signal).then(setRelease).catch(() => {});
    return () => controller.abort();
  }, []);
  /** Az app megnyitását próbáljuk; ha az oldal marad (nem váltott át az app), akkor nincs telepítve, és csak akkor ajánljuk a letöltést. */
  const openApp = () => {
    if (!initial) return;
    setAppTry("opening");
    let left = false;
    const onLeave = () => { left = true; };
    document.addEventListener("visibilitychange", onLeave);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("blur", onLeave);
    window.location.href = appLink(initial);
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onLeave);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("blur", onLeave);
      setAppTry(left || document.hidden ? "idle" : "missing");
    }, 1800);
  };
  const installed = Number(import.meta.env["VITE_APP_VERSION_CODE"] ?? 0);
  const update = isNativeApp() && release && needsUpdate(installed, release.versionCode);

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
            if (parsed) onJoin(parsed.token, name, parsed.color ?? initial?.color, parsed.ownerKey ?? (parsed.token === initial?.token ? initial.ownerKey : undefined));
            else toast.error("Ez nem érvényes szobakód vagy link.");
          }}
        >
          {scanning && (
            <QrScanner
              onResult={(text) => {
                setScanning(false);
                const p = parseRoomInput(text);
                if (p) setValue(text);
                else toast.error("Ez a QR-kód nem Private Place meghívó.");
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
          {update && release && <Button type="button" className="w-full rounded-full" onClick={() => { window.location.href = release.apk; }}>Frissítés letöltése</Button>}
          {initial && !isNativeApp() && isAndroidBrowser() && (
            <>
              <Button type="button" variant="outline" className="glass-button w-full rounded-full" disabled={appTry === "opening"} onClick={openApp}>Megnyitás az appban</Button>
              {appTry === "missing" && (
                <>
                  <p className="text-center text-xs text-muted-foreground">Az app nincs telepítve ezen a telefonon.</p>
                  {release && <Button type="button" className="w-full rounded-full" onClick={() => { window.location.href = release.apk; }}>Alkalmazás letöltése</Button>}
                </>
              )}
            </>
          )}
          <Button type="submit" className="w-full rounded-full" disabled={!parsed}>{update ? "Csatlakozás frissítés nélkül" : "Csatlakozás"}</Button>
          <Button type="button" variant="ghost" className="w-full rounded-full" onClick={onReject}>Elutasítás</Button>
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

function personStatus(p: RemotePerson) {
  if (!p.online) return "";
  if (!p.sharing) return "nem oszt meg";
  if (!p.at) return "";
  return kmh(p.speed);
}

function kmh(speed: number | null) {
  if (speed == null || Number.isNaN(speed)) return "– km/h";
  return `${Math.max(0, Math.round(speed * 3.6))} km/h`;
}
