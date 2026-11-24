# Architektúra

```
UI (Compose / SwiftUI)
   ↓ állapot: StateFlow / @Published
AppGraph / AppModel  (alkalmazás-szintű, nem az Activity/View élettartamához kötött)
   ├─ SharingEngine   nyers fix → DriftFilter → saját helyek → önkép + küldés (energia-ütemezéssel)
   ├─ PeerManager     szobák, üzenet-validálás, tagnévsor, nyomvonalak, aláírt gazdai műveletek
   ├─ Store           SharedPreferences/UserDefaults (JSON); Keychain a privát kulcsnak (iOS)
   └─ PeerTransport   WebRtcTransport (adatcsatorna) + NostrSignaling (titkosított SDP-csere)
domain/ (tiszta, platformfüggetlen logika – a TS-lib 1:1 portja, mindkét platformon azonos tesztekkel)
```

- **Android**: a `SharingEngine` az `Application`-ben él; a `SharingService` (foreground, `location` típus) csak a folyamatot tartja életben és az értesítést adja. Az indítást a megosztás-kapcsoló váltja ki (`AppGraph` figyeli az `engine.state.sharing`-et).
- **iOS**: `SharingEngine` + `LocationService` (`CLLocationManager`, háttérmód a megosztás alatt).
- **Életciklus**: előtér/háttér (`ProcessLifecycleOwner` / `scenePhase`) → `setVisible`, ami az energia-ütemezést (1 mp / 3 mp / 5 mp) és a küldési gyakoriságot vezérli; előtérbe lépéskor `peers.wake()` (újracsatlakozás + újraközlés).
- **Biztonsági határ**: minden bejövő P2P adat a `parse*` függvényeken megy át; a gazdai műveleteket a szoba `ownerKey`-ével ellenőrizzük.

## UI-minták
- `Accordion` / `SheetScaffold` / `TabContent` (Android: `ui/Accordion.kt`, iOS: `UI/Accordion.swift`): minden ablak ugyanezekből épül, így az animáció egységes (240 ms, ease-in-out).
- OTA: `domain/Update.kt` (tiszta, tesztelt kiadás-választás) + `data/Updater.kt` (hálózat, letöltés, telepítés) + `AppGraph.checkForUpdate/startUpdate`.
