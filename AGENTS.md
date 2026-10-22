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
- Keep private self-tracking in browser memory, separate from shared location writes; only the explicit sharing toggle may publish coordinates.
- Start private GPS observation automatically for signed-in map users, and never merge shared self-history into the private track so the own marker represents this device.
- Delete own location history through the authenticated invoker RPC after draining pending writes and disabling sharing, so deletion cannot race with queued publication.
- Use a numbered focus request for map centering so repeated taps on the same person always recenter the map.
