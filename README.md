# Private Place – natív (Kotlin + SwiftUI)

A Capacitor/React alkalmazás teljesen natív újraírása: **Android** (Kotlin, Jetpack Compose) és **iOS** (Swift, SwiftUI). Nincs WebView, nincs Node.

```
android/   Gradle projekt (Kotlin DSL) – nyisd meg Android Studióval
ios/       XcodeGen projekt (project.yml) – `cd ios && xcodegen generate`
```

## ⚠️ Állapot – olvasd el először

Ezt a kódbázist **nem fordítottam le és nem futtattam** (nem volt Android SDK / Xcode a környezetben). Amit ténylegesen ellenőriztem:
- a BIP‑340 Schnorr-implementáció referencia-algoritmussal azonos kimenetet ad a hivatalos 0. tesztvektorra;
- a zárójelek/blokkok párosak.

Az első fordításnál **számíts apró hibákra** (importok, API-nevek). A CI (`.github/workflows/app-build.yml`) lefuttatja az Android egységteszteket (a kiadást nem blokkolják).

Különösen ellenőrizd:
- függőségi verziók: `stream-webrtc-android 1.3.8`, `org.maplibre.gl:android-sdk 11.5.2`, iOS-en `stasel/WebRTC`, `maplibre-gl-native-distribution`, `swift-secp256k1` (a `P256K.Schnorr.PrivateKey.signature(for:)` hívás emlékezetből van);
- a `PeerConnection.Observer` / `RTCPeerConnectionDelegate` kötelező metódusai az adott WebRTC-verzióban.

## ❗ A P2P réteg NEM kompatibilis a régi (Capacitor) appal

A régi app `trystero`-t használt, aminek nincs natív portja, és a vezetékformátumát nem tudtam ellenőrizni (a `node_modules` nem volt a zipben). Ezért **új, saját protokoll** készült (Android és iOS egymással azonos, de a régi webes klienssel nem működik együtt):

- jelzés: nyilvános **Nostr-relék** (`wss://relay.damus.io`, `nos.lol`, `relay.primal.net` – `-PnostrRelays=…`-szal cserélhető), ephemeral esemény `kind 29333`, címke `["x", topicHash]`, BIP‑340 aláírással;
- `topicHash = SHA‑256("privateplace/v1/topic/" + token)`, titkosítás: AES‑256‑GCM, kulcs `SHA‑256("privateplace/v1/key/" + token)`, tartalom `base64url(nonce‖ct‖tag)` – a relék csak ezt látják;
- kapcsolat: WebRTC adatcsatorna (`"pp"`), STUN Google/Cloudflare, opcionális TURN (`-PturnUrls=…` Androidon, `Info.plist` `TURN_*` iOS-en); a kisebb azonosítójú fél ajánlatot tesz;
- üzenetek: `{"a":"hello|loc|ctrl|ask","d":…}`, a beérkező adatot ugyanazok a validátorok ellenőrzik, mint a TS-ben (`PeerMessages` / `Messages.swift`).

Mindenkinek át kell állnia az új appra. A szobakódok/QR-formátum (`TOKEN` vagy `TOKEN.gazdaKulcs`) és a `#szoba=…&nev=…&szin=…&gazda=…` link-formátum változatlan, így a meglévő kódok újra felhasználhatók.

## Paritás

| Funkció | Android | iOS |
|---|---|---|
| Drift-szűrő (`stationary.ts` 1:1 port), saját helyek (tanulás/korrekció) | ✅ | ✅ |
| Közlekedési mód, hibrid irány, energiagazdálkodás, nyomvonal | ✅ | ✅ |
| Szobák: létrehozás/csatlakozás/QR/kód/link, szín, törlés, kilépés | ✅ | ✅ |
| Gazdai aláírt `close`/`kick` (ECDSA P‑256, P1363 – a régivel azonos formátum) | ✅ | ✅ |
| Megosztáskérés + értesítés | ✅ | ✅ |
| Háttérben futás | Előtér-szolgáltatás (location), wake lock, „Leállítás/Kilépés” akció | Háttérbeli helymód (`UIBackgroundModes`) |
| Iránytű, járás-jelzés, akkumulátor | ✅ | ✅ |
| Cím lekérés (beleegyezéssel) | ✅ | ✅ |
| Térkép | MapLibre Native | MapLibre Native |
| Privát kulcs tárolása | alkalmazás-privát tároló (PKCS#8) | Keychain |

## Ami nincs portolva

- **Napló/debug nézet**.
- **Régi adatok átvétele** (profil, szobák, gazdai privát kulcsok): a WebView `localStorage`-a natívan nem olvasható. Ha a meglévő szobák gazdai jogát meg akarod tartani, a régi appból egy utolsó kiadásban exportálni kell őket (a régi JWK → PKCS#8/raw konverzió egyszerű). Enélkül a régi szobák tulajdonjoga elvész.
- A térképen a jelölők **monogramot** mutatnak (a profilkép a sávban és a listákban látszik); betűtípus a rendszer-alapértelmezett (DM Sans/Space Grotesk nincs becsomagolva).
- Meghívó-link: `privateplace://join/#szoba=…` nyitja az appot; https-linkhez saját domain + Android App Link / iOS Universal Link kell.
- A „matt üveg” Androidon áttetsző sötét felület (nincs valódi háttérelmosás); iOS-en `Material`.

## Korlátok (platform)

- **iOS** nem tart előtér-szolgáltatást: a háttérbeli helymód tartja életben a folyamatot; a WebRTC-kapcsolat háttérben így is megszakadhat – valós eszközön tesztelendő. A 1 mp/3 mp/5 mp GPS-intervallum iOS-en `desiredAccuracy` + `distanceFilter` közelítés.
- **Android 12+**: előtér-szolgáltatás csak látható alkalmazásból indítható → a megosztás-kapcsoló érintése indítja.
- Nincs push: megosztáskérés-értesítés csak futó alkalmazásnál érkezik (nincs szerver – ez a régi appra is igaz volt).

## GitHub Actions: APK + IPA, dátumjelzővel, kiadással

Indítás: Actions → „Private Place – natív APK és IPA építése” → Run workflow. Ugyanaz a séma, mint a régi workflow-nál:

- **dátumjelző** (budapesti idő) a fájlnevekben és a verzióban: `private-place-2026-11-11_1530.apk/.ipa`, `versionName = 2026.11.11-1530`;
- **Android**: kiadási aláírás az *állandó* kulccsal (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, alias `privateplace` – ugyanazok a titkok, mint eddig), utána `apksigner verify` + a tanúsítvány összevetése a kulcsfájléval. Kulcs nélkül **nem készül APK**;
- **iOS**: aláíratlan `.ipa` (Sideloadly/AltStore írja alá a saját Apple ID-ddel), mint eddig;
- **kiadás** (Releases): címke `build-<dátum>-<versionCode>` + `private-place-release.json`; csak sikeres Android build után készül.
- Opcionális titkok: `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`.

⚠️ **versionCode**: = futás sorszáma + `VERSION_CODE_OFFSET` (Settings → Variables). A natív APK ugyanazzal az `applicationId`-val (`hu.privateplace.app`) és kulccsal települ a régi Capacitor-app **fölé**, de csak ha a versionCode nagyobb a telepítettnél – új tárolóban a futásszám újraindul, ezért állíts be megfelelően nagy eltolást.

## OTA (megmaradt, Android)

Az app a `GITHUB_REPOSITORY` kiadásai közül a legújabbat nézi (`/releases/latest`), a címke végéről olvassa a versionCode-ot, és ha újabb, felajánlja a frissítést: letöltés folyamatjelzővel → rendszer-telepítő (FileProvider). Ellenőrzés: induláskor, előtérbe lépéskor (legfeljebb 10 percenként) és kézzel (Beállítások → Általános → Frissítés). Csak `https://github.com/.../releases/download/.../*.apk` URL fogadható el; ha a letöltés elbukik, a böngésző veszi át. iOS-en nincs önfrissítés (a platform nem engedi) – ott új `.ipa`-t kell telepíteni.

## Felület

- **Harmónika**: minden ablak (Szobák, Beállítások) szakaszai dinamikusan illeszkedő, 240 ms-os harmónikaként nyílnak/záródnak; az ablak magassága követi. A Beállítások fülei (Általános / Helyek / Engedélyek) átúsznak, a lap magassága lágyan igazodik. (Android: `animateContentSize` + `AnimatedVisibility`/`AnimatedContent`; iOS: `withAnimation` + a lap `presentationDetents` magassága a tartalomhoz mérve.)
- **Profilkép**: kompakt, 40 dp-s kerek kép kamera-jelvénnyel a névmező mellett, egy sorban.
- **Súgóbuborékok**: 6 egymondatos buborék (Kihagyás / Tovább n/6), a célelem közelében; a Beállításokban újraindítható.

## Build

```bash
# Android
cd android && gradle wrapper && ./gradlew :app:testDebugUnitTest :app:assembleDebug
# opcionális: -PturnUrls=turn:host:3478 -PturnUsername=… -PturnCredential=… -PnostrRelays=wss://a,wss://b

# iOS
brew install xcodegen && cd ios && xcodegen generate && open PrivatePlace.xcodeproj
```

Mélyebb architektúra-részletek: `ARCHITECTURE.md`.
