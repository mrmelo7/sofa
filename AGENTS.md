# Sofa Game Launcher — agent guide

Sofa Game Launcher (Sofa for short) is a controller-first game launcher for Windows handhelds (ROG Ally) that also registers as the Xbox full screen experience home app. Tauri 2 (Rust) backend, React 19 + TypeScript frontend.

Sofa is "SteamOS on Windows": in the full screen experience the user holds a controller and no mouse or keyboard, so everything a console user does must be possible with the gamepad alone. Touch and keyboard are secondary. A change that only works by touch is a bug, even if it looks right.

Each directory has its own `AGENTS.md` with the rules for that layer:

- `src/AGENTS.md` — React/TypeScript UI
- `src-tauri/AGENTS.md` — Rust and Tauri backend
- `tests/AGENTS.md` — frontend unit tests
- `docs/AGENTS.md` — product docs and business rules
- `widget/AGENTS.md` — Xbox Game Bar widget (C# UWP shell for the HUD)

## Commands

```sh
npm install                # also points git at .githooks (prepare)
npm run tauri dev          # app with hot reload
npm run check              # everything the CI runs; the pre-push hook runs this
npx tsc --noEmit           # typecheck
npm run lint               # biome ci: lint, format and import order (npm run format fixes)
npm test                   # tests/*.test.ts (Node 22.6+)
npx vite build             # frontend build
sh scripts/check-rust.sh   # cargo test (zero warnings) + Clippy -D warnings for macOS and Windows
```

Errors must surface here, never in CI. The versioned git hooks enforce it: `pre-commit` runs lint and typecheck (seconds); `pre-push` runs `npm run check`. The release CI (`.github/workflows/release.yml`) runs the same on `windows-latest`, so Windows-only code (`#[cfg(windows)]`) must compile there even if you develop on macOS: `scripts/check-rust.sh` runs Clippy on the whole crate for `x86_64-pc-windows-gnu` (needs `rustup target add x86_64-pc-windows-gnu`, `rustup component add clippy` and `brew install mingw-w64`; the MSVC target can't build `ring` from macOS). Never bypass the hooks with `--no-verify`.

Agent skills (TanStack Query, React composition, web interface guidelines, Rust best practices) are versioned in `.agents/skills/`; `.claude/skills` links there so Claude Code loads them in every checkout. Read the matching `SKILL.md` before working in its area, and review UI changes against `web-design-guidelines` (it fetches the current rules). `skills-lock.json` records where each one came from: to update, run `npx skills experimental_install`, review the diff of `.agents/skills/` and commit it together with the new hashes. Never update them as a side effect of another change.

## Ground rules

- Motion is part of the UI: animate meaningful state changes and use shared-element morphs when a card, icon or action opens a related view; keep controller focus stable and honour reduced motion (see `src/AGENTS.md`).
- Be critical of UI: fewer, better-placed controls beat more, and every visual change is looked at on screen at the Ally's size before it ships (`src/AGENTS.md`, "Reviewing UI changes").
- Smallest change that works. Reuse what exists (`services.ts`, `library.rs`, `network.rs`) before writing new helpers; no new dependency when an installed one or a few lines do the job.
- Delete dead code, styles and strings in the same change that makes them dead.
- Keep the `AGENTS.md` files short: together they must stay under 32 KiB, the most some agents read (`tests/guides.test.ts` checks it). One line per rule; remove rules that no longer apply.
- Code, comments, commit messages and `AGENTS.md` files: English. Product docs in `docs/`: Português (Brasil). User-facing text: `src/i18n.ts` in English, Português (Brasil) and Español.
- Commits: Conventional Commits (`feat:`, `fix:`, `ci:`, `docs:`), imperative, one topic each.
- Security boundary: the webview sends ids, never paths, URLs or commands; Rust re-resolves them. Remote pages (e.g. the Steam login window) never get a capability.

## Releases (OTA)

1. Bump the version in `package.json`, `package-lock.json` (top two entries), `src-tauri/Cargo.toml`, the `sofa` entry in `src-tauri/Cargo.lock` and the user agent in `src-tauri/src/network.rs`.
2. Commit, push to `main`, push tag `vX.Y.Z`.
3. CI runs three jobs: `check` (Biome, tests, `cargo test`), `widget` (Game Bar package) and `release` (installer + `latest.json` into a draft release). `check` runs in parallel and doesn't block the draft, so publish only when **all three** are green; installed apps pick it up from `releases/latest/download/latest.json`.

The updater only offers a higher version than the installed one; never re-release the same number.
