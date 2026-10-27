import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedRoom } from "@/lib/rooms";
import type { LocalProfile } from "@/lib/profile";
import { colorForDevice, parseHello, parseLocation, parseRoomControl, parseShareRequest, type HelloMessage, type LocMessage } from "@/lib/peerMessages";
import { appendTrackPoint } from "@/lib/tracking";
import { turnConfigFromEnv } from "@/lib/turn";
import { loadRoomControls, rememberRoomControl, verifyRoomControl, type RoomControl } from "@/lib/moderation";

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
  return { deviceId, name: "Névtelen", avatar: null, color: colorForDevice(deviceId), points: [], speed: null, acc: null, at: null, heading: null, battery: null, since: null, online: true, sharing: false };
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
  const [connectIssues, setConnectIssues] = useState(0);
  const joinedRef = useRef(new Map<string, Joined>());
  const peerDeviceRef = useRef(new Map<string, string>());
  const pendingLocRef = useRef(new Map<string, LocMessage>());
  const helloRef = useRef<HelloMessage | null>(null);
  const lastLocRef = useRef<LocMessage>(null);
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const onClosedRef = useRef(opts.onRoomClosed);
  onClosedRef.current = opts.onRoomClosed;
  const onAskRef = useRef(opts.onShareRequest);
  onAskRef.current = opts.onShareRequest;
  helloRef.current = profile && deviceId ? { deviceId, name: profile.name, avatar: profile.avatar } : null;

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
      if (m === null) return { ...prev, [dev]: { ...p, sharing: false, online: true, points: [], at: null, heading: null, since: null } };
      const now = Date.now();
      return {
        ...prev,
        [dev]: {
          ...p, sharing: true, online: true,
          points: appendTrackPoint(p.points, { lat: m.lat, lng: m.lng, t: now }, now),
          speed: m.speed, acc: m.acc, at: now,
          heading: m.heading ?? null,
          battery: m.battery !== undefined ? m.battery : p.battery,
          since: m.since != null ? now - (m.t - m.since) : p.since ?? now,
        },
      };
    });
  }, []);

  const dropDevice = useCallback((token: string, dev: string) => {
    const j = joinedRef.current.get(token);
    if (!j) return;
    for (const peerId of [...j.peers]) if (peerDeviceRef.current.get(peerId) === dev) j.peers.delete(peerId);
    let elsewhere = false;
    for (const [peerId, d] of peerDeviceRef.current) if (d === dev && peerInAnyRoom(peerId)) elsewhere = true;
    if (!elsewhere) setPeople((prev) => { const next = { ...prev }; delete next[dev]; return next; });
    refreshCounts();
  }, [refreshCounts]);

  const leaveRoom = useCallback(
    (token: string, removePeople: boolean) => {
      const j = joinedRef.current.get(token);
      if (!j) return;
      joinedRef.current.delete(token);
      void j.room.leave().catch(() => undefined);
      const gone: string[] = [];
      for (const peerId of j.peers) if (!peerInAnyRoom(peerId)) gone.push(peerId);
      if (gone.length) {
        setPeople((prev) => {
          const next = { ...prev };
          for (const peerId of gone) {
            const dev = peerDeviceRef.current.get(peerId);
            if (!dev || !next[dev]) continue;
            if (removePeople) delete next[dev];
            else next[dev] = { ...next[dev], online: false };
          }
          return next;
        });
      }
      refreshCounts();
    },
    [refreshCounts],
  );

  const tokensKey = rooms.map((r) => r.token).join(",");
  const ready = Boolean(profile && deviceId);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const wanted = new Set(tokensKey ? tokensKey.split(",") : []);
    for (const token of [...joinedRef.current.keys()]) if (!wanted.has(token)) leaveRoom(token, true);

    void (async () => {
      const { joinRoom } = await import("trystero");
      if (cancelled) return;
      const turnConfig = turnConfigFromEnv();
      for (const token of wanted) {
        if (joinedRef.current.has(token)) continue;
        const room = joinRoom({ appId: APP_ID, password: token, ...(turnConfig ? { turnConfig } : {}) }, token, {
          onJoinError: (e) => {
            console.warn("Szoba csatlakozási hiba", e);
            if (e && typeof e === "object" && "peerId" in e && e.peerId) setConnectIssues((n) => n + 1);
          },
        }) as unknown as MinimalRoom;
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
          refreshCounts();
          if (helloRef.current) void j.hello.send(helloRef.current, { target: peerId }).catch(() => undefined);
          void j.loc.send(lastLocRef.current, { target: peerId }).catch(() => undefined);
        };
        room.onPeerLeave = (peerId) => {
          j.peers.delete(peerId);
          refreshCounts();
          if (peerInAnyRoom(peerId)) return;
          const dev = peerDeviceRef.current.get(peerId);
          if (dev) setPeople((prev) => (prev[dev] ? { ...prev, [dev]: { ...prev[dev], online: false } } : prev));
        };
        j.hello.onMessage = (data, { peerId }) => {
          const h = parseHello(data);
          if (!h || h.deviceId === deviceId) return;
          if (isKicked(token, h.deviceId)) { j.peers.delete(peerId); refreshCounts(); return; }
          peerDeviceRef.current.set(peerId, h.deviceId);
          setPeople((prev) => {
            const p = prev[h.deviceId] ?? emptyPerson(h.deviceId);
            return { ...prev, [h.deviceId]: { ...p, name: h.name, avatar: h.avatar, online: true } };
          });
          refreshCounts();
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
            if (c.kind === "close") onClosedRef.current(token, "closed");
            else if (c.target === deviceId) onClosedRef.current(token, "kicked");
            else if (c.target) { rememberRoomControl(c); dropDevice(token, c.target); }
          });
        };
        j.ask.onMessage = (data, { peerId }) => {
          if (!parseShareRequest(data)) return;
          const dev = peerDeviceRef.current.get(peerId);
          if (dev) onAskRef.current?.(dev);
        };
        joinedRef.current.set(token, j);
      }
      refreshCounts();
    })();

    return () => {
      cancelled = true;
    };
  }, [tokensKey, ready, deviceId, leaveRoom, refreshCounts, applyLocation, dropDevice]);

  useEffect(
    () => () => {
      for (const token of [...joinedRef.current.keys()]) leaveRoom(token, true);
    },
    [leaveRoom],
  );

  useEffect(() => {
    const h = helloRef.current;
    if (!h) return;
    for (const j of joinedRef.current.values()) void j.hello.send(h).catch(() => undefined);
  }, [profile?.name, profile?.avatar]);

  const sendLocation = useCallback((m: LocMessage) => {
    lastLocRef.current = m;
    for (const j of joinedRef.current.values()) {
      if (j.peers.size) void j.loc.send(m).catch(() => undefined);
    }
  }, []);

  /** Aláírt tulajdonosi művelet elküldése és helyi alkalmazása. */
  const sendControl = useCallback(async (control: RoomControl) => {
    const j = joinedRef.current.get(control.token);
    if (j?.peers.size) {
      await j.control.send(control).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 400));
    }
    if (control.kind === "kick" && control.target) {
      rememberRoomControl(control);
      dropDevice(control.token, control.target);
    }
  }, [dropDevice]);

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

  return { people, roomPeers, roomMembers, connectIssues, sendLocation, sendControl, requestShare };
}
