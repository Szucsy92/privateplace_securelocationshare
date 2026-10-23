import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedRoom } from "@/lib/rooms";
import type { LocalProfile } from "@/lib/profile";
import { colorForDevice, parseHello, parseLocation, type HelloMessage, type LocMessage } from "@/lib/peerMessages";
import { appendTrackPoint } from "@/lib/tracking";
import { turnConfigFromEnv } from "@/lib/turn";

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
  close: Action<boolean>;
  peers: Set<string>;
};

function emptyPerson(deviceId: string): RemotePerson {
  return {
    deviceId,
    name: "Névtelen",
    avatar: null,
    color: colorForDevice(deviceId),
    points: [],
    speed: null,
    acc: null,
    at: null,
    online: true,
    sharing: false,
  };
}

/**
 * Közvetlen telefon–telefon kapcsolat (WebRTC) a mentett titkos szobákban.
 * Központi tárolás nincs: a kézfogáshoz nyilvános továbbítókat használunk,
 * az üzeneteket a szoba kódja titkosítja.
 */
export function usePeerNetwork(opts: {
  rooms: SavedRoom[];
  deviceId: string | null;
  profile: LocalProfile | null;
  onRoomClosed: (token: string) => void;
}) {
  const { rooms, deviceId, profile } = opts;
  const [people, setPeople] = useState<Record<string, RemotePerson>>({});
  const [roomPeers, setRoomPeers] = useState<Record<string, number>>({});
  const [connectIssues, setConnectIssues] = useState(0);
  const joinedRef = useRef(new Map<string, Joined>());
  const peerDeviceRef = useRef(new Map<string, string>());
  const pendingLocRef = useRef(new Map<string, LocMessage>());
  const helloRef = useRef<HelloMessage | null>(null);
  const lastLocRef = useRef<LocMessage>(null);
  const onClosedRef = useRef(opts.onRoomClosed);
  onClosedRef.current = opts.onRoomClosed;
  helloRef.current = profile && deviceId ? { deviceId, name: profile.name, avatar: profile.avatar } : null;

  const refreshCounts = useCallback(() => {
    const next: Record<string, number> = {};
    for (const [token, j] of joinedRef.current) next[token] = j.peers.size;
    setRoomPeers(next);
  }, []);

  const peerInAnyRoom = (peerId: string) => {
    for (const j of joinedRef.current.values()) if (j.peers.has(peerId)) return true;
    return false;
  };

  const applyLocation = useCallback((dev: string, m: LocMessage) => {
    setPeople((prev) => {
      const p = prev[dev] ?? emptyPerson(dev);
      if (m === null) return { ...prev, [dev]: { ...p, sharing: false, online: true, points: [], at: null } };
      const now = Date.now();
      return {
        ...prev,
        [dev]: {
          ...p,
          sharing: true,
          online: true,
          points: appendTrackPoint(p.points, { lat: m.lat, lng: m.lng, t: now }, now),
          speed: m.speed,
          acc: m.acc,
          at: now,
        },
      };
    });
  }, []);

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
          close: room.makeAction<boolean>("close"),
          peers: new Set(),
        };
        room.onPeerJoin = (peerId) => {
          j.peers.add(peerId);
          refreshCounts();
          if (helloRef.current) void j.hello.send(helloRef.current, { target: peerId }).catch(() => undefined);
          if (lastLocRef.current) void j.loc.send(lastLocRef.current, { target: peerId }).catch(() => undefined);
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
          peerDeviceRef.current.set(peerId, h.deviceId);
          setPeople((prev) => {
            const p = prev[h.deviceId] ?? emptyPerson(h.deviceId);
            return { ...prev, [h.deviceId]: { ...p, name: h.name, avatar: h.avatar, online: true } };
          });
          const pending = pendingLocRef.current.get(peerId);
          if (pending !== undefined) {
            pendingLocRef.current.delete(peerId);
            applyLocation(h.deviceId, pending);
          }
        };
        j.loc.onMessage = (data, { peerId }) => {
          const m = parseLocation(data);
          if (m === undefined) return;
          const dev = peerDeviceRef.current.get(peerId);
          if (!dev) {
            pendingLocRef.current.set(peerId, m);
            return;
          }
          applyLocation(dev, m);
        };
        j.close.onMessage = () => onClosedRef.current(token);
        joinedRef.current.set(token, j);
      }
      refreshCounts();
    })();

    return () => {
      cancelled = true;
    };
  }, [tokensKey, ready, deviceId, leaveRoom, refreshCounts, applyLocation]);

  useEffect(
    () => () => {
      for (const token of [...joinedRef.current.keys()]) leaveRoom(token, true);
    },
    [leaveRoom],
  );

  // Profilváltozás azonnal eljut mindenkihez.
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

  const announceClose = useCallback(async (token: string) => {
    const j = joinedRef.current.get(token);
    if (!j || !j.peers.size) return;
    await j.close.send(true).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 400));
  }, []);

  return { people, roomPeers, connectIssues, sendLocation, announceClose };
}
