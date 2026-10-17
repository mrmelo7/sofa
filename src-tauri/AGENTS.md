# Backend (Rust + Tauri 2)

`src/lib.rs` registers plugins, managed state and every command. One module per area: `library` (game scan, Steam helpers), `accounts` (Steam login and owned games), `hud` (HUD window, Xbox button), `hud_server` (local HTTP for the Game Bar widget; every HUD command must be allowlisted in `dispatch`), `session` (running game and play time), `game_settings` (per-game profile applied in `launch`), `display`, `ally` (ASUS WMI profiles and TDP), `power`, `xbox_mode`, `categories`, `store`, `uninstall`/`epic_uninstall`, `network`, `log` (`sofa.log`; log steps and statuses, never secrets).

## Commands

- Return `Result<T, String>` where the error string is an i18n key (`"steamSessionExpired"`). New keys go in `src/i18n.ts` (all three languages) and in the `serviceError` list in `src/services.ts`.
- Make a command `async` when it does IO, creates windows or reads cookies: on Windows those deadlock in synchronous commands. Move blocking work into `tauri::async_runtime::spawn_blocking`.
- Inputs from the webview are untrusted. Accept ids and re-resolve them (`library::scan`, `library::steam_app_id`); validate everything else against what the system reports (display modes must be in the enumerated list).
- Shared state goes through `app.manage(...)` behind a `Mutex`; bump a generation counter so late async results from a cancelled session are dropped (`accounts.rs`).

## Platform code

- Windows-only code sits behind `#[cfg(windows)]` with a non-Windows fallback, so the crate builds and tests on macOS.
- Win32 via `windows-sys` (enable features in `Cargo.toml`). Keep `unsafe` minimal, one call per block with a comment on why it's sound; prefer `Default` over `mem::zeroed`.
- Run system tools through `crate::system_exe` (System32 resolved by Windows, never `PATH`), with `CREATE_NO_WINDOW` and a timeout (`ally::powershell`). Scripts must not interpolate unvalidated input.
- Registry reads use `winreg`; Steam keys live under `HKCU\Software\Valve\Steam`.

## Network

- Use `network::client()` (HTTPS only, no redirects, timeout, versioned user agent) and `network::json` / `network::text`, which map HTTP statuses to error keys.
- Never log or return request URLs: Steam access tokens travel in the query string.
- Cache every external API response here, behind the webview's TanStack Query cache: `store::StoreCache` (in memory, a TTL per kind: deals 5 min, exchange rate 6 h, similar games 1 day, tags 1 week) or a JSON file in the app cache dir for data that must survive restarts (categories and store media, 30 days). Cache misses and empty answers too, with a shorter TTL, so a missing title isn't fetched on every render. Prefer one batch call over one request per item (Steam's `IStoreBrowseService/GetItems`, `appdetails` with `filters=price_overview`).

## Windows and capabilities

- Capabilities in `capabilities/*.json` are scoped by window label (`main`, `hud`). A window that loads remote content (`steam-login`) must not match any capability.
- Steam sessions live in the shared webview cookie store; read them with `cookies_for_url` and delete them on disconnect.

## Tests

- `#[cfg(test)] mod tests` at the bottom of each module for pure logic (parsers, validation, mappings). Hardware or OS integration tests are `#[ignore]`.
- `cargo test` must pass with zero warnings, and `cargo clippy --all-targets -- -D warnings` must be clean for macOS and for Windows (`scripts/check-rust.sh` runs both; CI runs it on Windows). When a lint is wrong for a line, use `#[expect(clippy::lint)]` with a comment saying why, never a bare `#[allow]`.
- Follow the `rust-best-practices` skill (`.agents/skills/`) with one project exception: commands return `Result<T, String>` whose error is an i18n key, so the UI never shows raw error text. Don't introduce `thiserror`/`anyhow` error types across the command boundary.
