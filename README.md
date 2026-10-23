# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Private Place – Android APK építése

1. GitHubon nyisd meg az adattárat → **Actions** → **Android APK építése** → **Run workflow**.
2. (Opcionális) A `public_url` mezőbe írd be a közzétett weboldal címét, így a meghívókban kattintható link is lesz.
3. Kb. 5–8 perc múlva a kész `private-place-<dátum_óraperc>.apk` a **Releases** alatt (és az Actions futás „Artifacts” részében) tölthető le.
4. Telefonon engedélyezd az ismeretlen forrásból való telepítést, majd telepítsd.

### Aláírás
Az APK a `signing/private-place.keystore` kulccsal aláírva készül, ha a GitHub titkok között szerepel az `ANDROID_KEYSTORE_PASSWORD`. Így minden új verzió a régi fölé telepíthető. Titok nélkül teszt aláírással készül (`-teszt` a fájlnévben).

Az ikon és az indítókép az `assets/android-res` mappából kerül be (újragenerálás: `python3 scripts/make-android-icons.py`).

Az alkalmazásban bekapcsolt megosztásnál a helyzet lezárt képernyőnél is továbbmegy; ezt egy állandó értesítés jelzi. Kikapcsolt megosztásnál a háttérben semmi nem fut.

### Opcionális: saját továbbító (TURN)
Ha két telefon szigorú mobilneten nem találja egymást, egy továbbító segít (pl. Cloudflare vagy Metered ingyenes kerete). Az adat ekkor is titkosítva megy át.
GitHub → Settings → Secrets and variables → Actions → New repository secret:
- `TURN_URLS` – pl. `turn:turn.pelda.hu:3478,turns:turn.pelda.hu:5349`
- `TURN_USERNAME`, `TURN_CREDENTIAL`

Utána építsd újra az APK-t.

Helyi építés: `bun run build:app`, majd `npx cap add android && node scripts/patch-android.mjs && npx cap sync android`.
