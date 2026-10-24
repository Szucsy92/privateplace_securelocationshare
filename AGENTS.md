<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep the map workspace in a viewport-sized shell with modal controls and a horizontal people rail so the page never needs vertical scrolling.
- The app has no accounts and no central location storage: identity is a local profile in localStorage, and locations travel peer-to-peer over WebRTC (trystero, public Nostr relays for signaling) so it runs without our own server.
- A room token is both the room id and the encryption password; it only leaves the device through the owner's share/QR panel, and room links put it in the URL hash so it never reaches a web server.
- Keep private self-tracking in memory; only the explicit sharing toggle may send coordinates to peers, and turning it off sends a null location so peers hide the marker.
- Validate every incoming peer message in src/lib/peerMessages.ts before it touches state, because any room member can send arbitrary data.
- Use MapLibre GL with a keyless OpenStreetMap style and set the worker URL explicitly (maplibre-gl-worker.mjs?url) so the map works in Vite dev, the web build and the APK.
- src/components/MapApp.tsx must stay router-independent because the Android APK renders it from app/main.tsx via vite.app.config.ts (static Capacitor build).
- APK and IPA are built only by the manual GitHub Actions workflow (.github/workflows/app-build.yml), which generates android/ and ios/ in CI, applies scripts/patch-android.mjs / scripts/patch-ios.mjs and publishes both to one dated Release; do not commit android/, ios/ or dist-app/. The IPA is unsigned (sideload) because there is no Apple developer account.
- Android icons/splash are pre-rendered into assets/android-res (scripts/make-android-icons.py) and copied by the patch script, because @capacitor/assets leaves the adaptive icon foreground as the Capacitor default.
- Release APKs are signed with the committed PKCS12 keystore signing/private-place.keystore (alias privateplace); its password lives only in the ANDROID_KEYSTORE_PASSWORD GitHub secret so the key stays stable across builds and updates install in place. Builds are stamped with Budapest date (file name, versionName) and versionCode = run number.
- Use a numbered follow request for map centering so repeated taps on the same person always recenter the map; tapping the followed person again stops following.
- Get positions through src/lib/locationSource.ts: browser geolocation on the web, the native background-geolocation plugin in the APK, with a background notification only while sharing is on, because WebView geolocation stops when the screen locks.
- TURN relays are optional and injected at build time (VITE_TURN_* from GitHub secrets, parsed in src/lib/turn.ts) so the app still needs no server of our own.
- The launch screen uses the icon's own corner color (#0B1425) as background and a feathered logo, so no icon square shows on startup.
- First run shows the permissions panel right after the name is saved (reopenable from Settings); one-shot glass hint bubbles are stored in localStorage and reset via Settings → Súgó.
- Share requests are a peer 'ask' action (validated by parseShareRequest); they only arrive while the app is running, since there is no server to push them.
