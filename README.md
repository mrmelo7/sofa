# Sofa Game Launcher

Sofa is a game launcher for Windows handhelds (like the ROG Ally) that you use with a controller. Think SteamOS, on Windows.

Built with Tauri 2 (Rust) and React.

## What it does

- **One library.** Finds your installed games from Steam, Epic, GOG and the Xbox app on its own, with no setup. Connect your Steam or Epic account to also see games you own but haven't installed.
- **Made for the controller.** Everything works with the gamepad: browse, search, launch, uninstall and change settings without touching the screen.
- **Store.** Compares PC game prices, keeps a wishlist (you can import yours from Steam), warns when a saved game gets cheaper and shows Epic's free games of the week.
- **HUD over your games.** An Xbox Game Bar widget shows FPS and lets you change power mode, TDP, fan curve, brightness and resolution while you play. Settings can be saved per game.
- **Xbox mode home.** Sofa can replace the Xbox full screen experience home app, so it opens when your device starts (Windows 11 24H2+).
- **Updates itself** from GitHub Releases.
- English, Português (Brasil) and Español.

### Controls

| Button | Action |
| --- | --- |
| D-pad / stick | Move |
| A | Open / confirm |
| B | Back |
| X | Favorite |
| Y | Install update (hide in game details) |
| LB / RB | Switch source |
| LT / RT | Previous / next page in the Store |
| Start | Settings |
| View | Main menu |
| Xbox | Open the HUD (Game Bar) |

The keyboard works too: arrows, Enter and Escape.

## What the installer changes

To be listed as an Xbox mode home app, Windows requires a signed package. The installer (run as administrator):

1. Turns on **developer mode**.
2. Installs the self-signed **`CN=Sofa` certificate** so that package is trusted.
3. Registers the Sofa package.
4. Sets Sofa as the home app, **only if you haven't picked one yet**.

Uninstalling removes the package, the certificate and the home-app setting. Developer mode stays on.

Your store passwords never reach Sofa: you sign in on Steam's and Epic's own pages, and disconnecting deletes the session.

## Develop

```sh
npm install
npm run tauri dev   # app with hot reload
npm run check       # everything the CI runs
```

`npm run dev` opens just the interface in the browser; add `?demo=1` for a demo library.

Rules for contributors (and AI agents) are in [AGENTS.md](AGENTS.md), including how to release. More detail:

- [Library and release rules](docs/biblioteca-e-lancamentos.md)
- [Windows checks](docs/windows-validation.md)

The update signing key lives outside the repo (`~/.tauri/sofa.key` and the `TAURI_SIGNING_PRIVATE_KEY*` secrets). If it is lost, installed apps stop receiving updates.
