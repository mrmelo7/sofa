# Frontend (React 19 + TypeScript)

`main.tsx` renders `App` (main window) or `Hud` (`?hud=1`, the floating HUD window). Features live in `features/`, shared UI in `components/`, pure logic in `library.ts` and `services.ts` (unit-tested in `tests/`).

## React

- Function components and hooks only; no state library. App-wide state stays in `App.tsx`, feature state in its component.
- Effects need stable dependencies: derive a string/id key instead of depending on arrays that are recreated on every scan (see `useCategories`).
- Async work must not restart when the language changes: read the translator through `tRef.current` instead of listing `t` as a dependency.
- Backend data goes through TanStack Query (`QueryClient` in `main.tsx`): `useQuery(commandQuery<T>("command", args))` for reads, `refetchInterval` for polling, `staleTime` for cache, and `useMutation` for writes that `invalidateQueries` what they change. Map failures with `queryError(query.error)`. Don't hand-roll `alive`/`setTimeout` loops or busy refs.
- Caching has two layers, and components never keep their own copies of fetched data:
  - **Webview, TanStack Query**: dedupes requests and keeps results per query key (the command plus its arguments). Set `staleTime` by how fast the data changes: prices and deals 5 min, shops, similar games and tags 1 h, exchange rate 6 h, things that only change on user action (device model, owned games) `Infinity` plus `invalidateQueries` after the mutation. Poll with `refetchInterval`, never timers.
  - **Backend, Rust**: every external API response is cached in Rust too (`StoreCache` with a TTL per kind, or a file in the app cache dir for data that should survive restarts, like categories), so restarts, the HUD widget and rate limits are covered. See `src-tauri/AGENTS.md`.
- `useCategories` still runs a manual, throttled effect; move it to queries when you touch it.

## Controller-first UI

- Every action must be reachable with the gamepad: `useInput` actions, `navigateSpatial` / `navigateControls`, `useFeatureInput` for pages and dialogs. Never rely on hover. Test new UI with the controller before touch; the controller is the primary input.
- Never use a native `<select>`: the controller can't open its list (a gamepad click isn't a user activation). Choices use `components/Picker.tsx` (A opens, up/down move, A picks, B closes); while its list is open `App.tsx` routes every action to it through `pickerInput`.
- Set focus on purpose: `data-initial-focus` in dialogs, move focus to the trigger before unmounting a focused element.
- Text fields use `keyboardOnActivate`: A opens Sofa's controller keyboard (D-pad + A, X deletes, Y inserts a space, B returns to the field); touch may use the system keyboard. `keyboardInput` takes priority in `useInput` in every window.

## Reviewing UI changes

Be critical: type checks and tests don't show layout.

- Look at every screen a change touches at the Ally's size (1280×720 CSS px) with real data, and walk it with the D-pad: nothing cut off or under the close X, no text squeezed into a narrow column, buttons on one line, text the player reads scrolls fully into view.
- One place for an action, on the thing that is open: no controls repeated on every list item, no text the screen doesn't need.

## Design language

Decided with the product owner; keep every new screen inside it.

- **Glass surfaces.** Pickers, settings cards, list rows, the system bar and HUD tiles use the `--glass*` tokens in `App.css`: translucent background, a thin light border and an inset top highlight. Real `backdrop-filter` blur only on the header's system bar: anywhere inside something that scrolls or animates (dialogs, the drawer, the HUD page, settings, the library), WebView2 leaves stale copies of the blurred surface (repeated text, focus rings that seem stuck). Art behind the detail frame is blurred with `filter` on its own `::before` layer.
- **Spatial navigation.** `navigateSpatial` always prefers a target aligned with the focused control (same row for left/right, same column for up/down) and one in the same scroll container; keep focusable controls laid out on a grid so those rules hold. `prefers-reduced-transparency` falls back to a solid colour. Header and footer are transparent with a soft fade.
- **Icon + label buttons.** Every text button carries a Phosphor icon before the label (after it for "next"-style actions); icon-only buttons get `aria-label`. The spacing rule lives on `button > svg:not(:only-child)`.
- **Motion is required.** New and changed interactions need deliberate transitions: shared-element morphs for covers → game pages and the search icon → Spotlight, coordinated card/text reveals, and brief feedback for toggles such as favourites. Preserve visual continuity on open and close; never let CSS transitions and JS animate the same transform. Verify the entire trajectory on screen, including rapid input and reversal, and restore controller focus. Tiles stagger in (`tile-in`, `--i` index); Home's selected cover widens into landscape art, shifting its neighbours, while hero facts rise without remounting action buttons. Controls take 150–320 ms, game-page morphs 480 ms, `GameBackdrop` a visible 4.8 s camera move that settles until a muted trailer is ready. GSAP owns camera, text and game-page morphs; the shared Dialog uses the Web Animations API for the Spotlight morph; Motion owns presence and pages, on separate elements. Revert GSAP contexts on cleanup; honour reduced motion in CSS and JS (`services.useReducedMotion`, which follows live preference changes).
- **Video backgrounds.** Home and game pages play one muted gameplay excerpt after selection rests; use `game_media.gameplay` and its cache for Steam/Epic/GOG matches. Select from all Steam movies, including gameplay beyond the gallery’s first three trailers; never substitute an arbitrary promotional trailer. `?demo` must play the real reviewed clips from `demoGameplay.ts` without desktop APIs. Keep the image beneath, fall back on missing media/offline, stop on game changes, pause when unfocused or behind a dialog, and respect reduced motion plus the Appearance toggle.
- **Game pages and store dialogs.** Owned games open a full-screen `.game-view`, morphing from the cover, title and Play action; B reverses it and restores focus. The store comparison keeps its `.detail-layout` modal with a fixed cover and scrolling content. Both must fit 720p without hiding actions; only their content panels scroll.
- **One line of facts.** Under a title, metadata goes in a single muted line joined by " · " (`gameMeta`): last session, hours played, size on disk or expected download.
- **Two loading states, chosen by what is known.** When the shape of the incoming content is known and its area is already on screen, use skeletons in that shape (`.skeleton` tiles in the library and store grids, `.offer-skeleton` rows): the page doesn't jump when data lands. When there is no layout to promise (launching a game, the first scan on Home, device searches), use `components/Loading.tsx`: the Sofa icon rumbling with one line saying what for. Never a bare spinner or a controller glyph; `GameControllerIcon` only where it means a controller (battery, no game running).
- **Network and battery stay visible.** `useOnline` drives the system bar's connected icon or "no connection" status; battery percentage stays next to its icon, with a charging glyph and low-charge colour. Screens that need the network still show their own `network` error when a call fails; installed games and the HUD keep working offline.
- **Quiet chrome.** The library count is context next to the tabs, not a heading. Covers carry no store badge and no name: Home's hero names the focused game, the library shows the name only on the focused tile, and a tile without art always shows it (`Cover`, `data-always`). The install prompt shows only on the focused tile; download progress always shows. Cards that leave Sofa (Windows settings) carry an "opens outside" icon.
- **Typography and colour.** Outfit variable font; accent `--accent` for the one primary action per view and for selection; `--muted` for secondary text. Uppercase, letter-spaced labels only for small eyebrows (`.eyebrow`, `.detail-meta`, `.deal-shop`).

## Text, errors and accessibility

- All UI text goes through `t(key)`; add the key to all three dictionaries in `i18n.ts` (the `Dict` type enforces it). Brand names (Steam, CPU Boost) are the only literals. More languages are planned: a new one is a dictionary plus its `LANGS` entry, the Steam locale in `categories::steam_locale`, the default price region in `App.tsx`, and `LANGUAGES` in `hud.rs`; keep keys language-neutral and never branch on a language outside those maps.
- Backend errors are i18n keys. Map them with `serviceError(e, known?)`, which returns a typed `MessageKey`; never show raw error text (it can contain URLs or tokens). Store errors as `MessageKey | ""`.
- Call the backend through `desktop<T>(command, args)`; it throws `desktopRequired` in the browser preview. `?demo` gives a demo library in dev.
- Icon-only buttons need `aria-label`; status messages use `role="status"`; toggles and selections use `aria-pressed` / `aria-expanded` (CSS styles off those attributes).

## Tooling

- Biome lints and formats (`npm run lint`, `npm run format`). Fix findings; when a rule is wrong for a line, suppress it there with `biome-ignore <rule>: <reason>`.
- Each window is code-split (`lazy` in `main.tsx`): keep the HUD free of main-window imports.

## CSS

- One stylesheet, `App.css`. Reuse `--accent` and `--muted`; HUD rules are scoped under `.floating-hud`.
- When you remove a component, remove its rules too, including copies inside `@media` blocks. Class names that are substrings of others (`account-connect` vs `library-account-connected`) need an exact search.
