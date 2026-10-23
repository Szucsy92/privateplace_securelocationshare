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

## Élő Hely – Android APK építése

1. GitHubon nyisd meg az adattárat → **Actions** → **Android APK építése** → **Run workflow**.
2. (Opcionális) A `public_url` mezőbe írd be a közzétett weboldal címét, így a meghívókban kattintható link is lesz.
3. Kb. 5–8 perc múlva a kész `elo-hely-<szám>.apk` a **Releases** alatt (és az Actions futás „Artifacts” részében) tölthető le.
4. Telefonon engedélyezd az ismeretlen forrásból való telepítést, majd telepítsd.

Helyi építés: `bun run build:app`, majd `npx cap add android && node scripts/patch-android.mjs && npx cap sync android`.
