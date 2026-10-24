# Private Place

**Közvetlen, privát, valós idejű helyzetmegosztás – fiók, központi adatbázis és nyomkövetés nélkül.**

A Private Place-szel élőben, másodpercről másodpercre láthatod, merre jár az, aki megengedi – és ő is téged. A helyzeted csak azokhoz jut el, akiknek te magad küldöd el a szobád kódját.

## Mire jó?

- **Nincs regisztráció:** nincs e-mail, jelszó vagy külső fiók. A neved és a képed csak a saját telefonodon tárolódik.
- **Közvetlen kapcsolat:** a helyadatok titkosítva, közvetlenül a telefonok között mennek (WebRTC), semmilyen szerveren nem tárolódnak.
- **Titkos, törölhető szobák:** kód, link vagy QR-kód alapján lehet belépni. A szoba törlésével a régi meghívó azonnal érvényét veszti.
- **Egy koppintásos megosztás:** a fejlécben egy gombbal indítod vagy állítod le – akkut kímél, ha nem kell.
- **Látod, ki lát:** a szem ikonnál mindig ott van, kik kapják éppen a helyzetedet.
- **Megosztás kérése:** megkérheted a szobatársadat, hogy ossza meg a helyzetét; ő értesítést kap.
- **Zsebben is megy:** bekapcsolt megosztásnál lezárt képernyőnél is továbbmegy (ezt értesítés jelzi).
- **Független térkép:** nyílt OpenStreetMap térkép, kulcs és reklám nélkül, sötét matt üveg felülettel; követés, északi vagy haladási irányú tájolás.

## Telepítő készítése (Android APK és iPhone IPA)

1. GitHubon: **Actions** → **Private Place – APK és IPA építése** → **Run workflow**.
2. (Opcionális) A `public_url` mezőbe a közzétett weboldal címét írva a meghívókban kattintható link is lesz.
3. Kb. 10 perc múlva a **Releases** alatt (és a futás „Artifacts” részében) letölthető a dátumos `private-place-<dátum>.apk` és `private-place-<dátum>.ipa`.

**Android:** engedélyezd az ismeretlen forrásból való telepítést, majd telepítsd az APK-t.
Az APK a `signing/private-place.keystore` kulccsal aláírva készül, ha a GitHub titkok között szerepel az `ANDROID_KEYSTORE_PASSWORD` – így minden új verzió a régi fölé telepíthető. Titok nélkül teszt aláírással készül.

**iPhone:** az IPA aláírás nélküli; számítógépről a Sideloadly vagy AltStore programmal, a saját Apple ID-ddel telepíthető.

### Opcionális: saját továbbító (TURN)
Ha két telefon szigorú mobilneten nem találja egymást, egy továbbító segít (az adat ekkor is titkosítva megy át). GitHub → Settings → Secrets and variables → Actions:
- `TURN_URLS` – pl. `turn:turn.pelda.hu:3478,turns:turn.pelda.hu:5349`
- `TURN_USERNAME`, `TURN_CREDENTIAL`

## Fejlesztés

```sh
bun install
bun run dev        # webes változat
bun run build:app  # telefonos csomag weboldali része
bun test tests
```

Az ikon és indítókép az `assets/android-res` mappában van (újragenerálás: `python3 scripts/make-android-icons.py`).
