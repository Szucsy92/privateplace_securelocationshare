import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { RoundedQRCode } from "@/components/RoundedQRCode";
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
  Palette,
  Trash2,
  Users,
  Bug,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ElasticScroll } from "@/components/ElasticScroll";
import PlacesPanel from "@/components/PlacesPanel";
import { applyPlaces, loadPlaces, newSpot, savePlaces, type FixLite, type Place } from "@/lib/places";
import { QrScanner, canScanQr } from "@/components/QrScanner";
import type { MapPerson, Orientation, TrackPoint } from "@/components/LiveMap";
import { usePeerNetwork, type RemotePerson } from "@/hooks/usePeerNetwork";
import { useElasticOverscroll } from "@/hooks/useElasticOverscroll";
import { useLandscape, useScrollFade } from "@/hooks/useLandscape";
import { appendTrackPoint, clearTrackHistory, publishIntervalMs, shouldPublishLocation } from "@/lib/tracking";
import { useVisibleClock } from "@/hooks/useVisibleClock";
import { SELF_COLOR, colorForDevice } from "@/lib/peerMessages";
import type { RosterEntry } from "@/lib/roomRoster";
import { loadPersonColors, savePersonColors, setPersonColor, SELF_COLOR_KEY, type PersonColors } from "@/lib/personColors";
import { PersonColorPicker } from "@/components/PersonColorPicker";
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
  roomQrValue,
  roomShareCode,
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
import { useSmoothHeight } from "@/lib/useSmoothHeight";
import { hybridHeading, type HeadingState } from "@/lib/heading";
import { watchCompass, watchBattery, watchWalking, requestCompassPermission } from "@/lib/deviceSensors";
import { watchNativeStop, setNativeLocationInterval, reapplyNativeLocationInterval, downloadAndInstallUpdate, installedVersionCode } from "@/lib/nativeRuntime";
import { CALM_AFTER_MS, desiredGpsIntervalMs, movementWake } from "@/lib/powerMode";
import { updateTransport, type TransportMode, type TransportState } from "@/lib/transport";
import { createDriftFilter, stopLabel, type StopState } from "@/lib/stationary";
import { buildReport, buildReportHtml, createDebugRecorder, deliverReport, overlayFrom, type DebugOverlay, type ScreenContext } from "@/lib/debugLog";
import { latestRelease, releaseRepository, needsUpdate, appLink, isAndroidBrowser, type AppRelease } from "@/lib/invitations";
import { headingFromTrack } from "@/lib/mapMath";
import { isNativeApp, prepareSharing, startLocationWatch } from "@/lib/locationSource";
import { createRoomAuthority, loadRoomControls, signRoomControl } from "@/lib/moderation";
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
  /** Helyi jelölőszín-átállítások (a saját és mások színe); csak ezen a telefonon érvényesek. */
  const [personColors, setPersonColors] = useState<PersonColors>({});
  const selfColor = personColors[SELF_COLOR_KEY] ?? SELF_COLOR;
  const changePersonColor = useCallback((id: string, color: string | null) => {
    setPersonColors((prev) => {
      const next = setPersonColor(prev, id, color);
      if (next !== prev) savePersonColors(next);
      return next;
    });
  }, []);
  const [pendingJoin, setPendingJoin] = useState<{ token: string; name: string | null; color?: RoomColor; ownerKey?: string } | null>(null);
  const [follow, setFollow] = useState<{ id: string; request: number } | null>(null);
  const [selfTrack, setSelfTrack] = useState<TrackPoint[]>([]);
  const [selfMeta, setSelfMeta] = useState<{ speed: number | null; acc: number | null; at: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("waiting");
  const [gpsRequest, setGpsRequest] = useState(0);
  // Csak látható képernyőnél ketyeg: háttérben nem ébreszti a processzort, és nem rendereli újra a felületet.
  const clock = useVisibleClock();
  const [hintsKey, setHintsKey] = useState(0);
  const selfTrackRef = useRef<TrackPoint[]>([]);
  const lastSentRef = useRef(0);
  // Energiatakarékos GPS-ütem: kívánt mérési köz a láthatóság, a megosztás, a nézők és a tartós állás alapján.
  const viewersRef = useRef(false);
  const calmRef = useRef(false);
  const wakeUntilRef = useRef(0);
  const powerRef = useRef<() => void>(() => undefined);
  powerRef.current = () => setNativeLocationInterval(desiredGpsIntervalMs({
    visible: document.visibilityState === "visible",
    sharing: prefsRef.current.sharing,
    viewers: viewersRef.current,
    calm: calmRef.current,
  }));
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const compassRef = useRef<HTMLSpanElement | null>(null);
  const landscape = useLandscape();
  const railRef = useElasticOverscroll<HTMLDivElement>(landscape ? "y" : "x");
  useScrollFade(railRef, landscape);
  const headingRef = useRef<HeadingState>({ source: "gps", angle: null });
  const sensorRef = useRef<number | null>(null);
  const fixBearingRef = useRef<number | null>(null);
  const batteryRef = useRef<number | null>(null);
  const stopRef = useRef<StopState | null>(null);
  // A szűrő állapota (horgony, álló-óra) túléli a figyelő újraindításait (visszatérés a háttérből, engedélyváltás).
  const driftFilterRef = useRef<ReturnType<typeof createDriftFilter> | null>(null);
  // Hibakereső napló: a nyers és a szűrt pozíció (csak a memóriában, küldésig nem hagyja el a telefont).
  const debugRef = useRef(createDebugRecorder());
  const [debugView, setDebugView] = useState<DebugOverlay | null>(null);
  const walkingRef = useRef(false);
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
  const [settingsView, setSettingsView] = useState<"main" | "trails" | "places">("main");
  // Saját helyek: a korrekció a szűrt pozíción fut; a tanuláshoz a korrekció előtti fixeket őrizzük.
  const [places, setPlaces] = useState<Place[]>([]);
  const placesRef = useRef<Place[]>([]);
  const recentFixesRef = useRef<FixLite[]>([]);
  const centerRef = useRef<(() => { lat: number; lng: number } | null) | null>(null);
  const [pickTarget, setPickTarget] = useState<{ placeId: string; spotId: string | null } | null>(null);
  const [placesOpenId, setPlacesOpenId] = useState<string | null>(null);
  useEffect(() => { const loaded = loadPlaces(); placesRef.current = loaded; setPlaces(loaded); }, []);
  const changePlaces = useCallback((next: Place[]) => { placesRef.current = next; setPlaces(next); savePlaces(next); }, []);
  const confirmPick = () => {
    const t = pickTarget;
    const c = centerRef.current?.();
    if (!t || !c) { toast.warning("A térkép még nem áll készen."); return; }
    changePlaces(placesRef.current.map((pl) => pl.id !== t.placeId ? pl : {
      ...pl,
      spots: t.spotId
        ? pl.spots.map((sp) => (sp.id === t.spotId ? { ...sp, lat: c.lat, lng: c.lng, bias: null, learnedAt: null, samples: 0 } : sp))
        : [...pl.spots, newSpot(c, `Pont ${pl.spots.length + 1}`)],
    }));
    finishPick(t.placeId);
  };
  const finishPick = (placeId: string) => { setPickTarget(null); setPlacesOpenId(placeId); setSettingsView("places"); setDialog("settings"); };
  useEffect(() => { if (dialog !== "settings" && !pickTarget) setSettingsView("main"); }, [dialog, pickTarget]);
  const [nativeStopReady, setNativeStopReady] = useState(false);
  const invitationRepoRef = useRef<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<AppRelease | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "downloading" | "permission">("idle");
  const [updatePercent, setUpdatePercent] = useState<number | null>(null);
  const startUpdate = async () => {
    if (!availableUpdate || updateStatus === "downloading") return;
    setUpdateStatus("downloading");
    setUpdatePercent(null);
    const state = await downloadAndInstallUpdate(availableUpdate.apk, setUpdatePercent);
    if (state === "installing") { setUpdateStatus("idle"); setUpdateDismissed(true); }
    else if (state === "needsPermission") setUpdateStatus("permission");
    else {
      // Tartalék: ha az appon belüli letöltés nem megy, a böngésző veszi át.
      toast.error("Az appon belüli letöltés nem sikerült, megnyitom a böngészőben.");
      setUpdateStatus("idle");
      setUpdateDismissed(true);
      window.location.href = availableUpdate.apk;
    }
  };
  const [updateCheck, setUpdateCheck] = useState<"idle" | "checking" | "latest" | "error">("idle");
  // Frissítés keresése: induláskor, az előtérbe visszatéréskor (legfeljebb 10 percenként) és a Beállításokban kézzel.
  // Kézi kereséskor az eredményt a Beállítások sora mutatja.
  const lastUpdateCheckRef = useRef(0);
  const checkForUpdate = useCallback(async (manual: boolean) => {
    const repo = releaseRepository();
    if (!repo) { if (manual) setUpdateCheck("error"); return; }
    if (manual) setUpdateCheck("checking");
    try {
      const [release, installed] = await Promise.all([latestRelease(repo), installedVersionCode()]);
      if (release && needsUpdate(installed, release.versionCode)) {
        setAvailableUpdate(release);
        setUpdateCheck("idle");
      } else if (manual) setUpdateCheck("latest");
      else setUpdateCheck("idle");
    } catch {
      setUpdateCheck(manual ? "error" : "idle");
    }
  }, []);
  useEffect(() => {
    if (!mounted || !nativeApp) return;
    const look = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastUpdateCheckRef.current < 10 * 60 * 1000) return;
      lastUpdateCheckRef.current = Date.now();
      void checkForUpdate(false);
    };
    look();
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, [mounted, nativeApp, checkForUpdate]);
  const selfMetaRef = useRef(selfMeta);
  useEffect(() => { setDebugView(prefs.debug ? overlayFrom(debugRef.current.entries()) : null); }, [prefs.debug]);
  selfMetaRef.current = selfMeta;
  const publishSelf = () => {
    const last = selfTrackRef.current.at(-1);
    if (!prefsRef.current.sharing || !last || Date.now() - last.t > 15000) return;
    // Adaptív küldési köz: látható/mozgó 1 mp, háttérben 2 mp, álló helyzetben 4 mp. A fogadó a mérési időkből
    // simít (animationDurationMs), ezért nincs szaggatás; mozgásindulásnál az onFix nullázza a lastSentRef-et.
    const sendNow = Date.now();
    const interval = publishIntervalMs({ visible: document.visibilityState === "visible", still: stopRef.current != null });
    if (!shouldPublishLocation(true, sendNow, lastSentRef.current, interval)) return;
    lastSentRef.current = sendNow;
    net.sendLocation({ lat: last.lat, lng: last.lng, t: last.t, speed: selfMetaRef.current?.speed ?? null, acc: selfMetaRef.current?.acc ?? null, heading: headingRef.current.angle, battery: batteryRef.current, since: sinceRef.current, stoppedSince: stopRef.current?.since ?? null, transport: transportRef.current.mode });
  };
  const debugContext = (): ScreenContext => ({
    stopText: stopLabel(stopRef.current?.since ?? null, Date.now(), false),
    speedText: selfMetaRef.current ? kmh(selfMetaRef.current.speed) : "",
    gpsStatus: String(gpsStatus),
    sharing: prefsRef.current.sharing,
    following: follow?.id === SELF,
    orientation: prefsRef.current.orientation,
    trails: prefsRef.current.showTrails,
    debugLayer: prefsRef.current.debug,
    theme: prefsRef.current.mapTheme,
    visible: document.visibilityState === "visible",
    version: (import.meta.env["VITE_APP_VERSION"] as string | undefined) || "webes változat",
    userAgent: navigator.userAgent,
  });
  const sendDebugLog = async (textOnly: boolean) => {
    const es = debugRef.current.entries();
    if (!es.length) { toast.info("Még nincs rögzített GPS-adat."); return; }
    const now = Date.now(), ctx = debugContext();
    const stamp = new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const result = await deliverReport(buildReport(es, ctx, now), buildReportHtml(es, ctx, now), stamp, { textOnly });
    if (result === "copied") toast.success("A napló a vágólapra került – illeszd be az üzenetbe.");
    else if (result === "downloaded") toast.success("A napló fájlként letöltődött.");
    else if (result === "failed") toast.error("A naplót nem sikerült elküldeni.");
  };
  const publishRef = useRef(publishSelf);
  publishRef.current = publishSelf;
  useEffect(() => {
    if (!mounted || !profile || stopped) return;
    // Az iránytű és a lépésfelismerés csak akkor fut, ha a képernyő látszik: zsebben az iránytű amúgy is
    // értelmetlen irányt adna, mozgás közben a GPS-irány pótolja. A lépésfelismerés a drift-szűrőt segíti,
    // ezért bekapcsolt megosztásnál háttérben is megmarad.
    const noop = () => {};
    let stopCompass = noop;
    let stopWalking = noop;
    let timer: ReturnType<typeof setInterval> | undefined;
    const startTimer = (ms: number) => { clearInterval(timer); timer = setInterval(() => publishRef.current(), ms); };
    const sync = () => {
      const visible = document.visibilityState === "visible";
      if (visible) {
        if (stopCompass === noop) {
          stopCompass = watchCompass(angle => {
            sensorRef.current = angle;
            headingRef.current = hybridHeading(headingRef.current, selfMetaRef.current?.speed ?? null, fixBearingRef.current, angle);
            setSelfHeading(headingRef.current.angle);
          });
        }
        if (stopWalking === noop) stopWalking = watchWalking(value => { walkingRef.current = value; });
      } else {
        stopCompass(); stopCompass = noop;
        if (!prefsRef.current.sharing) { stopWalking(); stopWalking = noop; }
      }
      startTimer(1000); // tartalék ütem: a küldés sűrűségét a publishSelf adaptív köze szabályozza
      powerRef.current();
    };
    const stopBattery = watchBattery(value => { batteryRef.current = value; setBattery(value); });
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { document.removeEventListener("visibilitychange", sync); stopCompass(); stopBattery(); stopWalking(); clearInterval(timer); };
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
    setPersonColors(loadPersonColors());
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

  // A sötét/világos kapcsoló az egész felületre hat (panelek, ablakok, kapszulák, beállítások), nem csak a térképre.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset["theme"] = prefs.mapTheme;
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
  const hasViewers = Object.values(net.roomPeers).some((n) => n > 0);
  viewersRef.current = hasViewers;
  useEffect(() => { powerRef.current(); }, [hasViewers, prefs.sharing]);

  // Saját GPS: mindig fut, privát; csak a megosztás kapcsoló küld a szobatársaknak.
  // Az Android-alkalmazásban bekapcsolt megosztásnál lezárt képernyőnél is folytatódik.
  const backgroundSharing = nativeApp && prefs.sharing;
  useEffect(() => {
    if (!mounted || !profile || stopped || !nativeStopReady || dialog === "welcome" || dialog === "permissions") return;
    setGpsStatus((s) => (s === "live" ? s : "waiting"));
    // Drift-szűrő: álló helyzetben a jelölő nem vándorol, a pontatlan hálózati fix nem ront a jó GPS-en.
    const driftFilter = (driftFilterRef.current ??= createDriftFilter());
    return startLocationWatch({
      background: backgroundSharing,
      onWatcherStarted: () => { reapplyNativeLocationInterval(); powerRef.current(); },
      onFix: (rawFix) => {
        const steppedFix = { ...rawFix, stepping: walkingRef.current };
        const fix = driftFilter(steppedFix);
        debugRef.current.push(steppedFix, fix);
        // A tanuláshoz a korrekció előtti, szűrt pozíciót őrizzük (utolsó ~25 fix).
        recentFixesRef.current = [...recentFixesRef.current.slice(-24), { lat: fix.lat, lng: fix.lng, acc: fix.acc }];
        const placed = applyPlaces(placesRef.current, fix);
        if (prefsRef.current.debug) setDebugView(overlayFrom(debugRef.current.entries()));
        const now = Date.now();
        const at = fix.at ?? now;
        const point = { lat: placed.point.lat, lng: placed.point.lng, t: at };
        selfTrackRef.current = appendTrackPoint(selfTrackRef.current, point, now);
        setSelfTrack(selfTrackRef.current);
        setSelfMeta({ speed: fix.speed, acc: fix.acc, at });
        selfMetaRef.current = { speed: fix.speed, acc: fix.acc, at };
        fixBearingRef.current = fix.bearing ?? headingFromTrack(selfTrackRef.current);
        headingRef.current = hybridHeading(headingRef.current, fix.speed, fixBearingRef.current, sensorRef.current);
        setSelfHeading(headingRef.current.angle);
        const wasStill = stopRef.current != null;
        stopRef.current = fix.stoppedSince != null ? { anchor: point, since: fix.stoppedSince } : null;
        // Mozgásindulásnál azonnal küldünk, hogy az álló helyzet ritkább ütemétől ne késsen a jelző.
        if (wasStill && stopRef.current == null) lastSentRef.current = 0;
        // Tartós állás → ritkább GPS (háttérben, néző mellett). Ritkított mérésnél a szűrő nem tud időben kilépni az
        // „áll” állapotból, ezért a nyers fixből külön észleljük az indulást, és azonnal visszaváltunk 1 mp-re.
        let calm = fix.stoppedSince != null && at - fix.stoppedSince >= CALM_AFTER_MS && now > wakeUntilRef.current;
        if (calmRef.current && movementWake(rawFix, stopRef.current?.anchor ?? null)) {
          calm = false;
          wakeUntilRef.current = now + 20000;
        }
        if (calm !== calmRef.current) { calmRef.current = calm; powerRef.current(); }
        transportRef.current = updateTransport(transportRef.current, fix.speed, at, manualRef.current);
        setTransport(transportRef.current.mode);
        setGpsStatus("live");
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
      lastSentRef.current = 0; // a küldési köz-ellenőrzés különben (now - now < köz) elnyelné az azonnali küldést
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
      Object.values(net.people)
        .map((p) => (personColors[p.deviceId] ? { ...p, color: personColors[p.deviceId] ?? p.color } : p))
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, "hu")),
    [net.people, personColors],
  );

  const mapPeople: MapPerson[] = useMemo(() => {
    const list: MapPerson[] = [];
    if (profile && selfTrack.length)
      list.push({ id: SELF, name: profile.name, avatarUrl: profile.avatar, color: selfColor, points: selfTrack, isSelf: true, heading: selfHeading, battery, stoppedSince: stopRef.current?.since ?? null, speed: selfMeta?.speed ?? null });
    for (const p of remote) {
      if (p.sharing && p.points.length)
        list.push({ id: p.deviceId, name: p.name, avatarUrl: p.avatar, color: p.color, points: p.points, heading: p.heading, battery: p.battery, stoppedSince: p.stoppedSince, speed: p.speed });
    }
    return list;
  }, [profile, selfTrack, remote, selfHeading, battery, selfMeta, selfColor]);

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
    const existing = rooms.find((r) => r.token === token);
    if (existing?.owner) {
      // Ugyanarról az eszközről a saját szobánkba nem vehetjük fel magunkat tagként.
      toast.info("Ez a te szobád: ugyanarról az eszközről nem veheted fel magad tagként.");
    } else if (deviceId && loadRoomControls().some((c) => c.kind === "kick" && c.token === token && c.target === deviceId)) {
      toast.error("Ebből a szobából a létrehozó eltávolított, ezért nem csatlakozhatsz újra.");
    } else if (existing) {
      if (!existing.ownerKey && ownerKey) {
        updateRooms((prev) => prev.map((r) => (r.token === token && !r.ownerKey ? { ...r, ownerKey } : r)));
        toast.success("A gazda kulcsa hozzáadva: a szoba törlése és az eltávolítások mostantól hozzád is megérkeznek.");
      } else {
        toast.info("Ebben a szobában már benne vagy.");
      }
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
    net.forgetRoom(room.token);
    toast.success(room.owner ? room.ownerPrivateKey ? "A szoba törölve." : "A régi szobát eltávolítottam erről a készülékről." : "Kiléptél a szobából.");
  };

  const kickPerson = async (room: SavedRoom, person: { deviceId: string; name: string }) => {
    if (person.deviceId === deviceId) return;
    if (!room.owner || !room.ownerKey || !room.ownerPrivateKey || !window.confirm(`Biztosan eltávolítod ${person.name}-t a szobából?`)) return;
    try { await net.sendControl(await signRoomControl(room.token, { ownerKey: room.ownerKey, ownerPrivateKey: room.ownerPrivateKey }, "kick", person.deviceId)); }
    catch { toast.error("Az eltávolítás nem sikerült."); }
  };
  const onlineCount = remote.filter((p) => p.online).length;
  const viewers = prefs.sharing ? remote.filter((p) => p.online) : [];
  const selfFresh = selfMeta ? clock - selfMeta.at < 15000 : false;

  const sharingStatus: SharingStatus = !prefs.sharing ? "off" : gpsStatus === "error" || gpsStatus === "denied" ? "lost" : !selfFresh ? "search" : "live";
  const windowRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useSmoothHeight(dialogRef, dialog !== null);
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
      className="map-workspace glass-shell map-live"
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
            debug={prefs.debug ? debugView : null}
            centerRef={centerRef}
          />
        </Suspense>
      </div>
      {pickTarget && win && (
        <>
          <div className="pointer-events-none absolute z-20" style={{ left: win.x + win.w / 2, top: win.y + win.h / 2, transform: "translate(-50%, -50%)" }} aria-hidden="true">
            <div className="relative h-10 w-10">
              <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-red-500" />
              <span className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-red-500" />
              <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-red-500" />
            </div>
          </div>
          <div className="glass absolute inset-x-3 z-20 flex items-center gap-2 rounded-2xl p-3" style={{ top: win.y + 8 }}>
            <p className="min-w-0 flex-1 text-xs">Told a térképet úgy, hogy a célkereszt a valódi helyed legyen, majd koppints az „Ide” gombra.</p>
            <Button size="sm" variant="outline" className="glass-button shrink-0 rounded-full" onClick={() => finishPick(pickTarget.placeId)}>Mégse</Button>
            <Button size="sm" className="shrink-0 rounded-full" onClick={confirmPick}>Ide</Button>
          </div>
        </>
      )}
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
        {prefs.debug && (
          <div className="map-overlay glass absolute left-3 top-3 flex max-w-[62%] items-center gap-2 rounded-2xl px-3 py-1.5 text-[11px] leading-tight" role="status" aria-label="Hibakereső állapot">
            <Bug className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              {debugView ? <>nyers GPS: <b>{debugView.offsetLabel}</b>{debugView.acc != null && <> · ±{Math.round(debugView.acc)} m</>}<br />{debugRef.current.last()?.out.mode === "still" ? "áll" : "mozog"}{debugRef.current.last()?.distrust ? " · Doppler cáfolva" : ""}</> : "várakozás GPS-re…"}
            </span>
            <Button size="sm" variant="ghost" className="h-7 shrink-0 rounded-full px-2 text-[11px]" onClick={() => void sendDebugLog(false)}>Napló</Button>
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
                color={selfColor}
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
                status={personStatus(p, clock)}
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
        open={availableUpdate !== null && !updateDismissed && dialog !== "welcome" && dialog !== "permissions"}
        onOpenChange={(open) => { if (!open && updateStatus !== "downloading") setUpdateDismissed(true); }}
      >
        <DialogContent className="glass-dialog w-[calc(100%-1.5rem)] max-w-[340px] gap-0 p-0" onInteractOutside={(e) => updateStatus === "downloading" && e.preventDefault()} onEscapeKeyDown={(e) => updateStatus === "downloading" && e.preventDefault()}>
          <PanelHeader
            title="Új frissítés elérhető"
            description={
              updateStatus === "downloading" ? `Letöltés…${updatePercent !== null ? ` ${updatePercent}%` : ""}`
              : updateStatus === "permission" ? "Engedélyezd a telepítést a Private Place számára, majd koppints újra a Letöltésre."
              : undefined
            }
          />
          <div className="flex justify-end gap-2 p-5">
            <Button variant="outline" className="glass-button rounded-full" disabled={updateStatus === "downloading"} onClick={() => setUpdateDismissed(true)}>Később</Button>
            <Button className="rounded-full" disabled={updateStatus === "downloading"} onClick={() => void startUpdate()}>Letöltés</Button>
          </div>
        </DialogContent>
      </Dialog>

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
          ref={dialogRef}
          className={`glass-dialog w-[calc(100%-1.5rem)] max-w-[390px] max-h-[94dvh] overflow-hidden gap-0 p-0${dialog === "settings" || dialog === "rooms" || dialog === "share" ? " compact-panel" : ""}`}
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
              <ElasticScroll className="max-h-[78dvh] px-4 pt-4">
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
                      members={roomMemberList(net.roster[room.token] ?? [], net.roomMembers[room.token] ?? [], net.people, net.avatars, personColors)}
                      self={profile ? { name: profile.name, avatar: profile.avatar, color: selfColor, custom: personColors[SELF_COLOR_KEY] !== undefined } : null}
                      onColor={changePersonColor}
                      onKick={p => void kickPerson(room, p)}
                      onForget={p => net.forgetMember(room.token, p.deviceId)}
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
              <ElasticScroll className="px-4 pb-4 pt-4">
                <div className="space-y-2.5">
                  <div className="glass-inset rounded-2xl p-3">
                    <ProfileForm
                      compact
                      color={selfColor}
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

                  <Button size="sm" variant="outline" className="glass-button w-full justify-between rounded-full" onClick={() => { setPlacesOpenId(null); setSettingsView("places"); }}>
                    <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />Saját helyek{places.length ? ` (${places.length})` : ""}</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>

                  <div className="glass-inset space-y-2 rounded-2xl p-3">
                    <label className="flex items-center gap-3 text-sm font-semibold">
                      <Checkbox checked={prefs.debug} onCheckedChange={(v) => updatePrefs({ debug: v === true })} />
                      Hibakereső réteg a térképen
                    </label>
                    <p className="text-xs text-muted-foreground">Piros pont: a telefon nyers GPS-pozíciója; piros kör: a jelentett pontosság; zöld gyűrű: a szűrő horgonya; a felirat az eltérést mutatja méterben és égtájjal.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" className="glass-button rounded-full" onClick={() => void sendDebugLog(false)}>Napló küldése</Button>
                      <Button size="sm" variant="outline" className="glass-button rounded-full" onClick={() => void sendDebugLog(true)}>Szöveg másolása</Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">A napló nem tartalmaz koordinátát, csak méterben megadott eltéréseket. Küldés előtt készíts képernyőképet is a térképről.</p>
                  </div>

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

                  {nativeApp && (
                    <div className="glass-inset flex items-center gap-3 rounded-2xl p-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Frissítés</p>
                        <p className="text-xs text-muted-foreground">
                          {updateCheck === "checking" ? "Keresés…"
                            : updateCheck === "latest" ? "A legújabb verzió van telepítve."
                            : updateCheck === "error" ? "A frissítések most nem érhetők el."
                            : availableUpdate ? `Új verzió érhető el (${availableUpdate.version || "új"}).`
                            : "Új verzió keresése a GitHub kiadásai között."}
                        </p>
                      </div>
                      {availableUpdate && updateCheck !== "checking" ? (
                        <Button size="sm" className="shrink-0 rounded-full" disabled={updateStatus === "downloading"} onClick={() => void startUpdate()}>
                          {updateStatus === "downloading" ? `Letöltés…${updatePercent !== null ? ` ${updatePercent}%` : ""}` : "Letöltés"}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="glass-button shrink-0 rounded-full" disabled={updateCheck === "checking"} onClick={() => void checkForUpdate(true)}>
                          Keresés
                        </Button>
                      )}
                    </div>
                  )}

                  <p className="text-center text-[11px] text-muted-foreground">
                    Private Place · {(import.meta.env["VITE_APP_VERSION"] as string | undefined) || "webes változat"}
                  </p>
                </div>
              </ElasticScroll>
            </>
          )}

          {dialog === "settings" && profile && settingsView === "places" && (
            <PlacesPanel
              places={places}
              onChange={changePlaces}
              getRecent={() => recentFixesRef.current}
              onPick={(t) => { setPickTarget(t); setDialog(null); }}
              openId={placesOpenId}
              onBack={() => setSettingsView("main")}
            />
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
              <ElasticScroll className="px-4 pb-4 pt-4">
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
  { text: "Alul a „Cím megjelenítése?” kérdésnél döntöd el, kérjen-e az app utcaneveket. Igen esetén csak a megnyitott jelölő helye megy a nyilvános címkeresőhöz; a Beállításokban bármikor átállíthatod.", place: "hint-address" },
  { text: "Koppints egy jelölőre a térképen: kis buborékban látod az akkuját, a távolságát tőled, a címét, és hogy éppen úton van vagy mióta áll egy helyben.", place: "hint-marker" },
  { text: "Koppints egy személyre a követéshez. Követés közben is lapozhatsz és nagyíthatsz; 4 másodperc után a térkép visszaáll rá. Ha nem oszt meg, innen kérheted meg rá.", place: "hint-rail" },
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

type RoomMember = { deviceId: string; name: string; avatar: string | null; color: string; custom: boolean; online: boolean; lastSeen: number };

/** A névsor és az éppen kapcsolódók egyesítése: elöl az online tagok, utánuk a legutóbb látottak. */
function roomMemberList(entries: RosterEntry[], onlineIds: string[], people: Record<string, RemotePerson>, avatars: Record<string, string>, colors: PersonColors): RoomMember[] {
  const online = new Set(onlineIds);
  const known = new Set<string>();
  const list: RoomMember[] = entries.map((e) => {
    known.add(e.deviceId);
    const p = people[e.deviceId];
    return { deviceId: e.deviceId, name: p?.name ?? e.name, avatar: p?.avatar ?? avatars[e.deviceId] ?? null, color: colors[e.deviceId] ?? p?.color ?? colorForDevice(e.deviceId), custom: colors[e.deviceId] !== undefined, online: online.has(e.deviceId), lastSeen: e.lastSeen };
  });
  for (const id of onlineIds) {
    const p = people[id];
    if (p && !known.has(id)) list.push({ deviceId: id, name: p.name, avatar: p.avatar, color: colors[id] ?? p.color, custom: colors[id] !== undefined, online: true, lastSeen: 0 });
  }
  return list.sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen);
}

function lastSeenText(at: number, now: number): string {
  const min = Math.max(0, Math.floor((now - at) / 60000));
  if (min < 1) return "épp most";
  if (min < 60) return `${min} perce`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} órája`;
  return `${Math.floor(hours / 24)} napja`;
}

function RoomRow({ room, peers, members, self, onColor, onKick, onForget, onShare, onDelete, onSave }: { room: SavedRoom; peers: number; members: RoomMember[]; self: { name: string; avatar: string | null; color: string; custom: boolean } | null; onColor: (id: string, color: string | null) => void; onKick: (person: RoomMember) => void; onForget: (person: RoomMember) => void; onShare: () => void; onDelete: () => void; onSave: (name: string, color: RoomColor) => void }) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(room.name);
  const [color, setColor] = useState<RoomColor>(room.color ?? DEFAULT_ROOM_COLOR);
  const [confirm, setConfirm] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const togglePicker = (id: string) => setPickerFor((cur) => (cur === id ? null : id));
  return <div className="room-row glass-inset rounded-lg p-3">
    <div className="flex items-center gap-3">
      <Button variant="ghost" className={`room-name-circle room-${room.color ?? DEFAULT_ROOM_COLOR}`} aria-label={`Szoba szerkesztése: ${room.name}`} onClick={() => { setName(room.name); setColor(room.color ?? DEFAULT_ROOM_COLOR); setEditing(v => !v); }}><span>{room.name}</span></Button>
      <Button variant="ghost" className="flex-1 h-20" aria-label={`Szoba megnyitása: ${room.name}`} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}><ChevronDown className={expanded ? "rotate-180 transition-transform" : "transition-transform"} /></Button>
      <Button variant="ghost" size="icon" className="h-14 w-14 rounded-full" aria-label={`QR-kód: ${room.name}`} onClick={onShare}><QrCode className="h-8 w-8" /></Button>
    </div>
    <div className="room-expansion" data-open={editing} inert={!editing}><div className="min-h-0 overflow-hidden"><form className="mt-3 space-y-3 border-t border-border pt-3" onSubmit={e => { e.preventDefault(); if (name.trim()) { onSave(name, color); setEditing(false); } }}>
      <Input aria-label="Szoba neve" value={name} maxLength={40} onChange={e => setName(e.target.value)} />
      <div className="grid grid-cols-5 gap-2">{ROOM_COLORS.map(c => <Button key={c} type="button" variant="ghost" size="icon" className={`room-choice room-${c}`} aria-label={ROOM_COLOR_NAMES[c]} aria-pressed={color === c} onClick={() => setColor(c)}><span className="room-swatch">{color === c && <Check className="h-3 w-3" />}</span></Button>)}</div>
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="icon" aria-label="Szerkesztés elvetése" onClick={() => setEditing(false)}><X /></Button><Button type="submit" disabled={!name.trim()}><Check />Mentés</Button></div>
    </form></div></div>
    <div className="room-expansion" data-open={expanded}><div className="min-h-0 overflow-hidden">
      <div className="flex justify-between items-center border-t border-border mt-3 pt-2"><span className="text-xs text-muted-foreground">{peers} kapcsolódva</span><Button variant="ghost" size="icon" className="text-destructive rounded-full" aria-label={room.owner ? `Szoba törlése: ${room.name}` : `Kilépés: ${room.name}`} onClick={() => setConfirm(true)}>{room.owner ? <Trash2 /> : <LogOut />}</Button></div>
      <ElasticScroll className="max-h-56"><div className="space-y-2 py-2">
        {self && <div>
          <div className="flex items-center gap-2"><span className="capsule-avatar viewer-avatar" style={{ "--person-color": self.color } as React.CSSProperties}>{self.avatar ? <img src={self.avatar} alt="" /> : self.name.charAt(0).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{self.name}</span><span className="block text-[10px] text-muted-foreground">Te</span></span><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Saját jelölőszín" aria-expanded={pickerFor === SELF_COLOR_KEY} title="Jelölőszín" onClick={() => togglePicker(SELF_COLOR_KEY)}><Palette /></Button></div>
          {pickerFor === SELF_COLOR_KEY && <PersonColorPicker value={self.color} custom={self.custom} onChange={(c) => onColor(SELF_COLOR_KEY, c)} />}
        </div>}
        {members.length === 0 && <p className="text-xs text-muted-foreground">Még senki nem csatlakozott.</p>}
        {members.map(p => <div key={p.deviceId}>
          <div className="flex items-center gap-2"><span className="capsule-avatar viewer-avatar" style={{ "--person-color": p.color } as React.CSSProperties}>{p.avatar ? <img src={p.avatar} alt="" /> : p.name.charAt(0).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{p.name}</span>{!p.online && p.lastSeen > 0 && <span className="block text-[10px] text-muted-foreground">Utoljára: {lastSeenText(p.lastSeen, Date.now())}</span>}</span><span className="status-dot" data-state={p.online ? "on" : "off"} /><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Jelölőszín: ${p.name}`} aria-expanded={pickerFor === p.deviceId} title="Jelölőszín" onClick={() => togglePicker(p.deviceId)}><Palette /></Button>{!p.online && <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Törlés a listából: ${p.name}`} title="Törlés a listából" onClick={() => onForget(p)}><Trash2 /></Button>}{room.owner && room.ownerPrivateKey && <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Eltávolítás a szobából: ${p.name}`} title="Eltávolítás a szobából" onClick={() => onKick(p)}><X /></Button>}</div>
          {pickerFor === p.deviceId && <PersonColorPicker value={p.color} custom={p.custom} onChange={(c) => onColor(p.deviceId, c)} />}
        </div>)}
      </div></ElasticScroll>
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
  // A másolt és megosztott kód a gazda ellenőrző kulcsát is viszi, hogy a csatlakozók elfogadják a törlést és az eltávolítást.
  const shareCode = roomShareCode(room.token, room.ownerKey);
  const text = link ?? shareCode;

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
        text: link ? "Csatlakozz a szobámhoz:" : `Szobakód: ${shareCode}`,
        ...(link ? { url: link } : {}),
      });
    } catch {
      /* a felhasználó bezárta */
    }
  };

  return (
    <div className="flex max-h-[94dvh] flex-col overflow-hidden">
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
            <RoundedQRCode
              value={roomQrValue(room.token, room.ownerKey)}
              size={210}
              bgColor={qrBackground}
              fgColor={qrColor}
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
  const [installed, setInstalled] = useState(() => Number(import.meta.env["VITE_APP_VERSION_CODE"] ?? 0));
  useEffect(() => { void installedVersionCode().then(setInstalled); }, []);
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
          {parsed && !parsed.ownerKey && !(parsed.token === initial?.token && initial?.ownerKey) && <p className="text-center text-xs text-muted-foreground">Gazdakulcs nélkül a szoba törlése és az eltávolítások nem érkeznek meg hozzád. Olvasd be a QR-kódot, vagy másold be a teljes megosztott kódot.</p>}
          <Button type="submit" className="w-full rounded-full" disabled={!parsed}>{update ? "Csatlakozás frissítés nélkül" : "Csatlakozás"}</Button>
          <Button type="button" variant="ghost" className="w-full rounded-full" onClick={onReject}>Elutasítás</Button>
        </form>
      </ElasticScroll>
    </>
  );
}

function ProfileForm(props: {
  color?: string | undefined;
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
          style={{ "--person-color": props.color ?? SELF_COLOR } as React.CSSProperties}
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
  if (!p.online) return "";
  if (!p.sharing) return "nem oszt meg";
  if (!p.at) return "";
  // A küldő szűrője dönt az állásról: ha megállást jelez, a sebesség biztosan 0 (nem maradhat meg a régi érték).
  if (p.stoppedSince != null) return kmh(0);
  // Elavult mérés sebességét nem mutatjuk (a legutolsó érték nem ragadhat be).
  if (now - p.at >= 15000) return kmh(null);
  return kmh(p.speed);
}

function kmh(speed: number | null) {
  if (speed == null || Number.isNaN(speed)) return "– km/h";
  return `${Math.max(0, Math.round(speed * 3.6))} km/h`;
}
