import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedRoom } from "@/lib/rooms";
import type { LocalProfile } from "@/lib/profile";
import { colorForDevice, parseHello, parseLocation, parseRoomControl, parseShareRequest, type HelloMessage, type LocMessage } from "@/lib/peerMessages";
import { appendTrackPoint, clearTrackHistory } from "@/lib/tracking";
import { turnConfigFromEnv } from "@/lib/turn";
import { kicksForRoom, loadRoomControls, rememberRoomControl, verifyRoomControl, type RoomControl } from "@/lib/moderation";
import { dropRoster, keepAvatars, loadAvatars, loadRosters, removeMember, saveAvatars, saveRosters, setAvatar, touchMember, upsertMember, type Avatars, type Rosters } from "@/lib/roomRoster";
import { freshLocation, acceptMeasurement, announcement } from "@/lib/locationFreshness";
import type { TransportMode } from "@/lib/transport";

export type TrackPoint = { lat: number; lng: number; t: number };

export type RemotePerson = {
  deviceId: string;
  name: string;
  avatar: string | null;
  color: string;
  points: TrackPoint[];
  speed: number | null;
  acc: number | null;
  at: number | null;
  heading: number | null;
  battery: number | null;
  since: number | null;
  online: boolean;
  sharing: boolean;
  transport: TransportMode | null;
  measurementAt: number | null;
  stoppedSince: number | null;
};

const APP_ID = "hu.elohely.app/v1";

type SendFn<T> = (data: T, options?: { target?: string | string[] | null }) => Promise<void>;
type Action<T> = { send: SendFn<T>; onMessage: ((data: T, ctx: { peerId: string }) => void) | null };
type MinimalRoom = {
  makeAction: <T>(name: string) => Action<T>;
  leave: () => Promise<void>;
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
};
type Joined = {
  room: MinimalRoom;
  hello: Action<HelloMessage>;
  loc: Action<LocMessage>;
  control: Action<RoomControl>;
  ask: Action<boolean>;
  peers: Set<string>;
};

function emptyPerson(deviceId: string): RemotePerson {
  return { deviceId, name: "Névtelen", avatar: null, color: colorForDevice(deviceId), points: [], speed: null, acc: null, at: null, heading: null, battery: null, since: null, online: true, sharing: false, transport: null, measurementAt: null, stoppedSince: null };
}

const isKicked = (token: string, dev: string) => loadRoomControls().some((c) => c.kind === "kick" && c.token === token && c.target === dev);

/**
 * Közvetlen telefon–telefon kapcsolat (WebRTC) a mentett titkos szobákban.
 * A tulajdonosi műveleteket (törlés, eltávolítás) a szoba aláíró kulcsával ellenőrizzük.
 */
export function usePeerNetwork(opts: {
  rooms: SavedRoom[];
  deviceId: string | null;
  profile: LocalProfile | null;
  onRoomClosed: (token: string, reason: "closed" | "kicked") => void;
  onShareRequest?: (deviceId: string) => void;
}) {
  const { rooms, deviceId, profile } = opts;
  const [people, setPeople] = useState<Record<string, RemotePerson>>({});
  const [roomPeers, setRoomPeers] = useState<Record<string, number>>({});
  const [roomMembers, setRoomMembers] = useState<Record<string, string[]>>({});
  /** Szobánként a valaha bemutatkozott tagok (csak helyi névsor; az online állapotot a roomMembers adja). */
  const [roster, setRoster] = useState<Rosters>({});
  const rosterRef = useRef<Rosters>({});
  /** A névsorban szereplő tagok profilképei (eszközazonosító szerint), hogy a lekapcsolódott tagok is látsszanak a képükkel. */
  const [avatars, setAvatars] = useState<Avatars>({});
  const avatarsRef = useRef<Avatars>({});
  const [connectIssues, setConnectIssues] = useState(0);
  /** Növelésével a hiányzó szobák újracsatlakoznak (a főeffekt csak a még nem csatlakozott tokeneket építi fel). */
  const [epoch, setEpoch] = useState(0);
  const joinedRef = useRef(new Map<string, Joined>());
  const peerDeviceRef = useRef(new Map<string, string>());
  const pendingLocRef = useRef(new Map<string, LocMessage>());
  /** Szobánként azok az eszközök, amelyek már bemutatkoztak: a kilépéskor akkor is eltávolíthatók, ha közben lekapcsolódtak. */
  const roomDevicesRef = useRef(new Map<string, Set<string>>());
  /** Szobánként: mikor csatlakoztunk utoljára, és hányszor próbáltuk már újra (a visszalépéshez). */
  const joinedAtRef = useRef(new Map<string, number>());
  const triesRef = useRef(new Map<string, number>());
  /** A még folyamatban lévő kilépések: azonos tokennel csak ezek befejezése után lehet újra csatlakozni. */
  const leavingRef = useRef(new Map<string, Promise<void>>());
  /** A „kérem a bemutatkozásodat” üzenetek korlátozása résztvevőnként. */
  const wantHelloRef = useRef(new Map<string, number>());
  const nullTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const helloRef = useRef<HelloMessage | null>(null);
  const lastLocRef = useRef<LocMessage>(null);
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const onClosedRef = useRef(opts.onRoomClosed);
  onClosedRef.current = opts.onRoomClosed;
  const onAskRef = useRef(opts.onShareRequest);
  onAskRef.current = opts.onShareRequest;
  helloRef.current = profile && deviceId ? { deviceId, name: profile.name, avatar: profile.avatar } : null;

  const updateAvatars = useCallback((change: (current: Avatars) => Avatars) => {
    const next = change(avatarsRef.current);
    if (next === avatarsRef.current) return;
    avatarsRef.current = next;
    saveAvatars(next);
    setAvatars(next);
  }, []);

  const updateRoster = useCallback((change: (current: Rosters) => Rosters) => {
    const next = change(rosterRef.current);
    if (next === rosterRef.current) return;
    rosterRef.current = next;
    saveRosters(next);
    setRoster(next);
    // Olyan tag képét, aki már egyik névsorban sem szerepel, nem tartjuk meg.
    const members = new Set<string>();
    for (const list of Object.values(next)) for (const e of list) members.add(e.deviceId);
    updateAvatars((a) => keepAvatars(a, members));
  }, [updateAvatars]);

  useEffect(() => {
    const loaded = loadRosters();
    rosterRef.current = loaded;
    setRoster(loaded);
    const pictures = loadAvatars();
    avatarsRef.current = pictures;
    setAvatars(pictures);
  }, []);

  const refreshCounts = useCallback(() => {
    const counts: Record<string, number> = {};
    const members: Record<string, string[]> = {};
    for (const [token, j] of joinedRef.current) {
      counts[token] = j.peers.size;
      const devs = new Set<string>();
      for (const peerId of j.peers) {
        const dev = peerDeviceRef.current.get(peerId);
        if (dev && !isKicked(token, dev)) devs.add(dev);
      }
      members[token] = [...devs];
    }
    setRoomPeers(counts);
    setRoomMembers(members);
  }, []);

  const peerInAnyRoom = (peerId: string) => {
    for (const j of joinedRef.current.values()) if (j.peers.has(peerId)) return true;
    return false;
  };

  const applyLocation = useCallback((dev: string, m: LocMessage) => {
    setPeople((prev) => {
      const p = prev[dev] ?? emptyPerson(dev);
      if (m === null) return { ...prev, [dev]: { ...p, sharing: false, online: true, points: [], at: null, heading: null, since: null, measurementAt: null } };
      const now = Date.now();
      if (p.measurementAt !== null && m.t < p.measurementAt) return prev;
      if (!acceptMeasurement(p.measurementAt, m)) return { ...prev, [dev]: { ...p, online: true, heading: m.heading ?? p.heading, battery: m.battery ?? p.battery, transport: m.transport ?? p.transport, stoppedSince: m.stoppedSince ?? p.stoppedSince } };
      const age = Math.max(0, now - m.t);
      return {
        ...prev,
        [dev]: {
          ...p, sharing: true, online: true,
          points: appendTrackPoint(p.points, { lat: m.lat, lng: m.lng, t: now - age }, now),
          speed: m.speed, acc: m.acc, at: now - age, measurementAt: m.t,
          heading: m.heading ?? null,
          battery: m.battery !== undefined ? m.battery : p.battery,
          since: m.since != null ? now - (m.t - m.since) : p.since ?? now,
          transport: m.transport ?? p.transport,
          stoppedSince: m.stoppedSince ?? null,
        },
      };
    });
  }, []);

  const dropDevice = useCallback((token: string, dev: string) => {
    updateRoster((r) => removeMember(r, token, dev));
    const j = joinedRef.current.get(token);
    if (!j) return;
    roomDevicesRef.current.get(token)?.delete(dev);
    for (const peerId of [...j.peers]) if (peerDeviceRef.current.get(peerId) === dev) j.peers.delete(peerId);
    let elsewhere = false;
    for (const [peerId, d] of peerDeviceRef.current) if (d === dev && peerInAnyRoom(peerId)) elsewhere = true;
    if (!elsewhere) setPeople((prev) => { const next = { ...prev }; delete next[dev]; return next; });
    refreshCounts();
  }, [refreshCounts, updateRoster]);

  const leaveRoom = useCallback(
    (token: string, removePeople: boolean) => {
      const j = joinedRef.current.get(token);
      if (!j) return Promise.resolve();
      joinedRef.current.delete(token);
      joinedAtRef.current.delete(token);
      const leaving: Promise<void> = Promise.resolve().then(() => j.room.leave()).catch(() => undefined);
      leavingRef.current.set(token, leaving);
      void leaving.then(() => { if (leavingRef.current.get(token) === leaving) leavingRef.current.delete(token); });
      const devs = new Set<string>(roomDevicesRef.current.get(token) ?? []);
      roomDevicesRef.current.delete(token);
      for (const peerId of j.peers) {
        const d = peerDeviceRef.current.get(peerId);
        if (d) devs.add(d);
      }
      const stillThere = (d: string) => {
        for (const set of roomDevicesRef.current.values()) if (set.has(d)) return true;
        for (const [peerId, dd] of peerDeviceRef.current) if (dd === d && peerInAnyRoom(peerId)) return true;
        return false;
      };
      const gone = [...devs].filter((d) => !stillThere(d));
      // Már sehol sem szereplő kapcsolatok bejegyzései törölhetők (különben újracsatlakozásonként gyűlnének).
      for (const peerId of j.peers) if (!peerInAnyRoom(peerId)) { peerDeviceRef.current.delete(peerId); pendingLocRef.current.delete(peerId); wantHelloRef.current.delete(peerId); }
      if (gone.length) {
        setPeople((prev) => {
          const next = { ...prev };
          for (const dev of gone) {
            if (!next[dev]) continue;
            if (removePeople) delete next[dev];
            else next[dev] = { ...next[dev], online: false };
          }
          return next;
        });
      }
      refreshCounts();
      return leaving;
    },
    [refreshCounts],
  );

  /**
   * Elakadt szobák újracsatlakoztatása: ha senki nem kapcsolódik, a jelzőkapcsolat vagy a hálózat közben megszakadhatott
   * (háttérbe kerülés, hálózatváltás). Visszalépéssel próbálkozik, hogy ne terhelje az akkumulátort, ha a másik fél egyszerűen offline.
   */
  const reconnectStalled = useCallback((force: boolean) => {
    const now = Date.now();
    for (const [token, j] of [...joinedRef.current]) {
      if (j.peers.size > 0) { triesRef.current.delete(token); continue; }
      const tries = triesRef.current.get(token) ?? 0;
      const wait = force ? 8000 : Math.min(30000 * 2 ** tries, 180000);
      if (now - (joinedAtRef.current.get(token) ?? 0) < wait) continue;
      triesRef.current.set(token, tries + 1);
      void leaveRoom(token, false).then(() => setEpoch((n) => n + 1));
    }
  }, [leaveRoom]);

  const tokensKey = rooms.map((r) => r.token).join(",");
  const ready = Boolean(profile && deviceId);

  useEffect(() => {
    if (!ready) { for (const token of [...joinedRef.current.keys()]) void leaveRoom(token, true); return; }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const wanted = new Set(tokensKey ? tokensKey.split(",") : []);
    for (const token of [...joinedRef.current.keys()]) if (!wanted.has(token)) void leaveRoom(token, true);

    void (async () => {
      let joinRoom: typeof import("trystero").joinRoom;
      try {
        ({ joinRoom } = await import("trystero"));
      } catch (e) {
        // Betöltési hiba (pl. rossz hálózat): nem hagyjuk végleg csatlakozás nélkül.
        console.warn("A kapcsolati modul nem töltődött be", e);
        setConnectIssues((n) => n + 1);
        if (!cancelled) retryTimer = setTimeout(() => setEpoch((n) => n + 1), 5000);
        return;
      }
      if (cancelled) return;
      const turnConfig = turnConfigFromEnv();
      for (const token of wanted) {
        if (joinedRef.current.has(token)) continue;
        // Azonos tokennel nem lehet új csatlakozást indítani, amíg a régi kilépés nem fejeződött be.
        const pendingLeave = leavingRef.current.get(token);
        if (pendingLeave) {
          await pendingLeave;
          if (cancelled) return;
          if (joinedRef.current.has(token)) continue;
        }
        let room: MinimalRoom;
        try {
          room = joinRoom({ appId: APP_ID, password: token, ...(turnConfig ? { turnConfig } : {}) }, token, {
            onJoinError: (e) => {
              console.warn("Szoba csatlakozási hiba", e);
              setConnectIssues((n) => n + 1);
            },
          }) as unknown as MinimalRoom;
        } catch (e) {
          // Egy szoba hibája nem akadályozhatja a többi szoba csatlakozását.
          console.warn("Szoba létrehozási hiba", e);
          setConnectIssues((n) => n + 1);
          continue;
        }
        const j: Joined = {
          room,
          hello: room.makeAction<HelloMessage>("hello"),
          loc: room.makeAction<LocMessage>("loc"),
          control: room.makeAction<RoomControl>("ctrl"),
          ask: room.makeAction<boolean>("ask"),
          peers: new Set(),
        };
        room.onPeerJoin = (peerId) => {
          j.peers.add(peerId);
          triesRef.current.delete(token);
          refreshCounts();
          if (helloRef.current) void j.hello.send(helloRef.current, { target: peerId }).catch(() => undefined);
          const first = announcement(lastLocRef.current, Date.now());
          if (first !== undefined) void j.loc.send(first, { target: peerId }).catch(() => undefined);
          // A gazda aláírt eltávolításait továbbadjuk: így a lemaradt tagok (és maga az eltávolított) is értesülnek, a gazda online léte nélkül is.
          for (const kick of kicksForRoom(token)) void j.control.send(kick, { target: peerId }).catch(() => undefined);
        };
        room.onPeerLeave = (peerId) => {
          const leftDevice = peerDeviceRef.current.get(peerId);
          if (leftDevice) updateRoster((r) => touchMember(r, token, leftDevice, Date.now()));
          j.peers.delete(peerId);
          pendingLocRef.current.delete(peerId);
          refreshCounts();
          if (peerInAnyRoom(peerId)) return;
          const dev = peerDeviceRef.current.get(peerId);
          peerDeviceRef.current.delete(peerId);
          wantHelloRef.current.delete(peerId);
          if (dev) setPeople((prev) => (prev[dev] ? { ...prev, [dev]: { ...prev[dev], online: false } } : prev));
        };
        j.hello.onMessage = (data, { peerId }) => {
          if (!j.peers.has(peerId)) return;
          const h = parseHello(data);
          if (!h || h.deviceId === deviceId) return;
          if (isKicked(token, h.deviceId)) { j.peers.delete(peerId); refreshCounts(); return; }
          peerDeviceRef.current.set(peerId, h.deviceId);
          updateRoster((r) => upsertMember(r, token, h, Date.now(), deviceId));
          if (rosterRef.current[token]?.some((e) => e.deviceId === h.deviceId)) updateAvatars((a) => setAvatar(a, h.deviceId, h.avatar));
          let known = roomDevicesRef.current.get(token);
          if (!known) { known = new Set(); roomDevicesRef.current.set(token, known); }
          known.add(h.deviceId);
          setPeople((prev) => {
            const p = prev[h.deviceId] ?? emptyPerson(h.deviceId);
            return { ...prev, [h.deviceId]: { ...p, name: h.name, avatar: h.avatar, online: true } };
          });
          refreshCounts();
          // A másik fél kérte a bemutatkozásunkat (az övé nálunk már megvan): egyszer válaszolunk, így nincs oda-vissza küldözgetés.
          if (h.want && helloRef.current) void j.hello.send(helloRef.current, { target: peerId }).catch(() => undefined);
          const pending = pendingLocRef.current.get(peerId);
          if (pending !== undefined) {
            pendingLocRef.current.delete(peerId);
            applyLocation(h.deviceId, pending);
          }
        };
        j.loc.onMessage = (data, { peerId }) => {
          if (!j.peers.has(peerId)) return;
          const m = parseLocation(data);
          if (m === undefined) return;
          const dev = peerDeviceRef.current.get(peerId);
          if (!dev) {
            pendingLocRef.current.set(peerId, m);
            // Az ismeretlen küldő bemutatkozása elveszhetett: néhány másodpercenként újra elkérjük.
            const now = Date.now();
            if (helloRef.current && now - (wantHelloRef.current.get(peerId) ?? 0) > 4000) {
              wantHelloRef.current.set(peerId, now);
              void j.hello.send({ ...helloRef.current, want: true }, { target: peerId }).catch(() => undefined);
            }
            return;
          }
          applyLocation(dev, m);
        };
        j.control.onMessage = (data) => {
          const c = parseRoomControl(data);
          const saved = roomsRef.current.find((r) => r.token === token);
          if (!c || c.token !== token || !saved?.ownerKey) return;
          void verifyRoomControl(c, saved.ownerKey).then((ok) => {
            if (!ok) return;
            if (c.kind === "close") { updateRoster((r) => dropRoster(r, token)); onClosedRef.current(token, "closed"); }
            else if (c.target === deviceId) { rememberRoomControl(c); updateRoster((r) => dropRoster(r, token)); onClosedRef.current(token, "kicked"); }
            else if (c.target) { rememberRoomControl(c); dropDevice(token, c.target); }
          }).catch(() => undefined);
        };
        j.ask.onMessage = (data, { peerId }) => {
          if (!j.peers.has(peerId) || !parseShareRequest(data)) return;
          const dev = peerDeviceRef.current.get(peerId);
          if (dev) onAskRef.current?.(dev);
        };
        joinedRef.current.set(token, j);
        joinedAtRef.current.set(token, Date.now());
      }
      refreshCounts();
    })().catch((e) => console.warn("Szobacsatlakozási hiba", e));

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [tokensKey, ready, deviceId, epoch, leaveRoom, refreshCounts, applyLocation, dropDevice, updateRoster, updateAvatars]);

  useEffect(
    () => () => {
      for (const token of [...joinedRef.current.keys()]) void leaveRoom(token, true);
      for (const t of nullTimersRef.current) clearTimeout(t);
    },
    [leaveRoom],
  );

  useEffect(() => {
    const h = helloRef.current;
    if (!h) return;
    for (const j of joinedRef.current.values()) void j.hello.send(h).catch(() => undefined);
  }, [profile?.name, profile?.avatar]);

  const broadcastLoc = useCallback((m: LocMessage) => {
    for (const j of joinedRef.current.values()) {
      if (j.peers.size) void j.loc.send(m).catch(() => undefined);
    }
  }, []);

  const sendLocation = useCallback((m: LocMessage) => {
    lastLocRef.current = m;
    for (const t of nullTimersRef.current) clearTimeout(t);
    nullTimersRef.current = [];
    broadcastLoc(m);
    // A „megosztás leállt” jelzés elveszhet (épp újracsatlakozó kapcsolat): röviden megismételjük, amíg a megosztás ki van kapcsolva.
    if (m === null) {
      nullTimersRef.current = [1500, 5000].map((ms) => setTimeout(() => { if (lastLocRef.current === null) broadcastLoc(null); }, ms));
    }
  }, [broadcastLoc]);

  // A csatlakozott nézők metaadat-frissítést akkor is kapnak, ha a küldő áll.
  // Az eredeti mérési időt ismételjük: elavult mérést sosem álcázunk frissnek.
  useEffect(() => {
    const timer = setInterval(() => {
      const latest = lastLocRef.current;
      if (!latest || !freshLocation(latest, Date.now())) return;
      for (const j of joinedRef.current.values()) if (j.peers.size) void j.loc.send(latest).catch(() => undefined);
    }, 5000);
    // Elakadt szobák ellenőrzése akkor is, ha nem osztunk meg semmit.
    const watchdog = setInterval(() => reconnectStalled(false), 15000);
    const announce = () => {
      const msg = announcement(lastLocRef.current, Date.now());
      for (const j of joinedRef.current.values()) {
        if (helloRef.current) void j.hello.send(helloRef.current).catch(() => undefined);
        // Elavult (de bekapcsolt) megosztásnál nem küldünk „leállt” jelzést: az a nézőnél törölné a jelölőt és az útvonalat.
        if (msg !== undefined) void j.loc.send(msg).catch(() => undefined);
      }
    };
    const wake = () => { announce(); reconnectStalled(true); };
    const onVisible = () => { if (document.visibilityState === "visible") wake(); };
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("resume", onVisible);
    return () => {
      clearInterval(timer); clearInterval(watchdog);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("resume", onVisible);
    };
  }, [reconnectStalled]);

  /** Aláírt tulajdonosi művelet elküldése és helyi alkalmazása. */
  const sendControl = useCallback(async (control: RoomControl) => {
    // Saját magunkat sosem távolítjuk el (ugyanarról az eszközről sem).
    if (control.kind === "kick" && control.target === deviceId) return;
    const j = joinedRef.current.get(control.token);
    if (j?.peers.size) {
      await j.control.send(control).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 400));
    }
    if (control.kind === "kick" && control.target) {
      rememberRoomControl(control);
      dropDevice(control.token, control.target);
    }
  }, [dropDevice, deviceId]);

  /** Egy szoba névsorának törlése (szoba törlésekor vagy kilépéskor). */
  const forgetRoom = useCallback((token: string) => updateRoster((r) => dropRoster(r, token)), [updateRoster]);

  /** Egy tag törlése a helyi névsorból eltávolítás nélkül (csak lekapcsolódott tagnál van értelme: ha újra bemutatkozik, visszakerül). */
  const forgetMember = useCallback((token: string, dev: string) => updateRoster((r) => removeMember(r, token, dev)), [updateRoster]);

  const requestShare = useCallback((dev: string) => {
    let sent = false;
    for (const j of joinedRef.current.values()) {
      const targets = [...j.peers].filter((peerId) => peerDeviceRef.current.get(peerId) === dev);
      if (!targets.length) continue;
      void j.ask.send(true, { target: targets }).catch(() => undefined);
      sent = true;
    }
    return sent;
  }, []);

  /** Egy személy helyben tárolt útvonalának törlése (az aktuális pozíció marad). */
  const clearTrail = useCallback((dev: string) => {
    setPeople((prev) => (prev[dev] ? { ...prev, [dev]: { ...prev[dev], points: clearTrackHistory(prev[dev].points) } } : prev));
  }, []);

  return { people, roomPeers, roomMembers, roster, avatars, connectIssues, sendLocation, sendControl, forgetRoom, forgetMember, requestShare, clearTrail };
}
