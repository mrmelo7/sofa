import {
  AppWindowIcon,
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  ArrowsOutIcon,
  ArrowUUpLeftIcon,
  BluetoothIcon,
  DownloadSimpleIcon,
  EyeIcon,
  FileTextIcon,
  FolderIcon,
  LinkBreakIcon,
  MagnifyingGlassIcon,
  MonitorPlayIcon,
  PlayIcon,
  PlusIcon,
  PowerIcon,
  SignInIcon,
  SignOutIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  TrashIcon,
  VibrateIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { Dialog } from "../components/Dialog";
import { ItemRow } from "../components/ItemRow";
import { Picker } from "../components/Picker";
import { LANGS, type Lang, type Translate } from "../i18n";
import { type Game, type Preferences, type Region, regions } from "../library";
import {
  commandQuery,
  demo,
  type MessageKey,
  type Notify,
  navigateControls,
  pickerInput,
  serviceError,
  useFeatureInput,
} from "../services";
import { type Provider, providers, type useLibrary } from "../useLibrary";
import type { useUpdates } from "../useUpdates";
import { ControllerCharge, usePower } from "./Power";

export type SettingsPanel =
  | "library"
  | "apps"
  | "appearance"
  | "controllers"
  | "updates";
type SetPrefs = Dispatch<SetStateAction<Preferences>>;

const titles: Record<SettingsPanel, MessageKey> = {
  library: "librarySettings",
  apps: "apps",
  appearance: "appearance",
  controllers: "controllers",
  updates: "updates",
};

/** Frame shared by every settings panel: title and close button (Dialog adds the status). */
export function SettingsDialog({
  panel,
  t,
  onClose,
  children,
}: {
  panel: SettingsPanel;
  t: Translate;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog label={t(titles[panel])} onClose={onClose}>
      <div className="settings-head">
        <h1>{t(titles[panel])}</h1>
        <button onClick={onClose} aria-label={t("close")}>
          <XIcon />
        </button>
      </div>
      <div className="settings-body">{children}</div>
    </Dialog>
  );
}

/** Sign-in state and actions for one store account (Steam, Epic). */
export function AccountSection({
  t,
  provider,
  account,
}: {
  t: Translate;
  provider: Provider;
  account: ReturnType<typeof useLibrary>["accounts"][Provider];
}) {
  // Signing out deletes the saved session; ask once, like power actions do.
  const [confirming, setConfirming] = useState(false);
  const disconnectButton = useRef<HTMLButtonElement>(null);
  // Back to the button that asked, so the controller doesn't land on the close X.
  const stopConfirming = () => {
    setConfirming(false);
    requestAnimationFrame(() => disconnectButton.current?.focus());
  };
  return (
    <section className="library-account">
      <div>
        <h2>{providerNames[provider]}</h2>
        <p>{t(`${provider}LibraryDescription`)}</p>
      </div>
      {account.connected || demo ? (
        <div className="library-account-connected">
          <span>
            {t(`${provider}LibraryConnected`, {
              count: String(account.owned?.length ?? 0),
            })}
          </span>
          <div className="detail-actions">
            {!demo && !confirming && (
              <button
                ref={disconnectButton}
                aria-disabled={account.busy}
                onClick={() => !account.busy && setConfirming(true)}
              >
                <SignOutIcon />
                {t("disconnect")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          data-initial-focus={provider === "steam" ? true : undefined}
          className="accent"
          disabled={!isTauri()}
          aria-disabled={account.busy}
          aria-busy={account.busy}
          onClick={() => !account.busy && account.connect()}
        >
          <SignInIcon weight="bold" />
          {t(account.busy ? "connecting" : `connect${providerNames[provider]}`)}
        </button>
      )}
      {confirming && (
        // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not form fields (<fieldset>).
        <div
          className="detail-actions"
          role="group"
          aria-label={t("disconnect")}
          data-confirm
        >
          <p>{t(`${provider}DisconnectConfirm`)}</p>
          <button
            data-initial-focus
            data-confirm-cancel
            // biome-ignore lint/a11y/noAutofocus: the controller needs focus on the safe choice when the confirmation appears.
            autoFocus
            onClick={stopConfirming}
          >
            <ArrowUUpLeftIcon />
            {t("cancel")}
          </button>
          <button
            className="accent"
            onClick={() => {
              stopConfirming();
              account.disconnect();
            }}
          >
            <SignOutIcon weight="bold" />
            {t("disconnect")}
          </button>
        </div>
      )}
      {account.error && (
        <p className="inline-error" role="alert">
          {t(account.error)}
        </p>
      )}
      <p className="muted">{t(`${provider}LibraryPrivacy`)}</p>
    </section>
  );
}
const providerNames = { steam: "Steam", epic: "Epic" } as const;

export function LibrarySettings({
  t,
  library,
  prefs,
  onRestore,
  onShowRecommendations,
}: {
  t: Translate;
  library: ReturnType<typeof useLibrary>;
  prefs: Preferences;
  onRestore: (game: Game) => void;
  /** Brings back store recommendations marked "not interested". */
  onShowRecommendations: (appIds: string[]) => void;
}) {
  const hidden = library.games.filter((game) => prefs.hidden.includes(game.id));
  return (
    <>
      <div className="library-accounts">
        {providers.map((provider) => (
          <AccountSection
            key={provider}
            t={t}
            provider={provider}
            account={library.accounts[provider]}
          />
        ))}
      </div>
      <p className="muted">{t("otherSourcesInstalledOnly")}</p>
      {/* The one place to rescan installed games and refresh owned store games. */}
      <button
        aria-disabled={library.refreshing}
        aria-busy={library.refreshing}
        onClick={() => !library.refreshing && void library.refresh()}
      >
        <ArrowClockwiseIcon />
        {t("refresh")}
      </button>
      {/* Hidden games live only here; restoring puts them back in the library. */}
      <section aria-label={t("hidden")}>
        <h2>
          {t("hidden")} ({hidden.length})
        </h2>
        {hidden.length === 0 ? (
          <p className="muted">{t("emptyHidden")}</p>
        ) : (
          <ul className="item-list">
            {hidden.map((game) => (
              <ItemRow key={game.id} name={game.title}>
                <button onClick={() => onRestore(game)}>
                  <EyeIcon />
                  {t("restoreGame")}
                </button>
              </ItemRow>
            ))}
          </ul>
        )}
      </section>
      {/* Store recommendations the player isn't interested in, newest first; any can come back. */}
      <section
        aria-label={t("hiddenRecommendations", { count: "" })}
        data-hidden-recommendations
      >
        <h2>
          {t("hiddenRecommendations", {
            count: String(prefs.notInterested.length),
          })}
        </h2>
        {prefs.notInterested.length === 0 ? (
          <p className="muted">{t("noHiddenRecommendations")}</p>
        ) : (
          <>
            <ul className="item-list">
              {[...prefs.notInterested].reverse().map((appId) => (
                <ItemRow
                  key={appId}
                  name={prefs.opinionTitles[appId] ?? `Steam ${appId}`}
                >
                  <button
                    onClick={() => {
                      onShowRecommendations([appId]);
                      // The row goes away; stay in the list instead of losing focus.
                      requestAnimationFrame(() =>
                        document
                          .querySelector<HTMLElement>(
                            "[data-hidden-recommendations] button",
                          )
                          ?.focus(),
                      );
                    }}
                  >
                    <EyeIcon />
                    {t("showRecommendations")}
                  </button>
                </ItemRow>
              ))}
            </ul>
            {prefs.notInterested.length > 1 && (
              <button
                onClick={() => onShowRecommendations(prefs.notInterested)}
              >
                <EyeIcon />
                {t("showAllRecommendations")}
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}

type XboxMode = { home: boolean; startup: boolean; active: boolean | null };

export function AppearanceSettings({
  t,
  lang,
  setLang,
  region,
  prefs,
  setPrefs,
  notify,
}: {
  t: Translate;
  lang: Lang;
  setLang: (lang: Lang) => void;
  region: Region;
  prefs: Preferences;
  setPrefs: SetPrefs;
  notify: Notify;
}) {
  const queryClient = useQueryClient();
  // Null when Sofa's identity package isn't registered (dev builds).
  const xboxMode =
    useQuery({
      ...commandQuery<XboxMode | null>("xbox_mode_status"),
      enabled: !demo && isTauri(),
    }).data ?? null;
  const fullscreen = useQuery({
    queryKey: ["fullscreen"],
    queryFn: () =>
      isTauri()
        ? getCurrentWindow().isFullscreen()
        : document.fullscreenElement !== null,
  });
  const toggleFullscreen = useMutation({
    mutationFn: async (on: boolean) => {
      if (isTauri()) await getCurrentWindow().setFullscreen(on);
      else if (on) await document.documentElement.requestFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["fullscreen"] }),
    onError: (error) => notify(serviceError(error)),
  });
  const startup = !!xboxMode?.home && !!xboxMode.startup;
  const toggleStartup = useMutation({
    mutationFn: (on: boolean) => invoke("set_xbox_mode_startup", { on }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["xbox_mode_status"] }),
    onError: (error) => notify(serviceError(error)),
  });
  return (
    <>
      <div className="field">
        {t("language")}
        <Picker
          label={t("language")}
          value={lang}
          options={(Object.keys(LANGS) as Lang[]).map((code) => ({
            value: code,
            label: LANGS[code],
          }))}
          onChange={setLang}
        />
      </div>
      <div className="field">
        {t("priceRegion")}
        <Picker
          label={t("priceRegion")}
          value={region}
          options={regions.map((code) => ({
            value: code,
            label: t(`region_${code}`),
          }))}
          onChange={(region) => setPrefs((p) => ({ ...p, region }))}
        />
      </div>
      <div className="field">
        {t("density")}
        <Picker
          label={t("density")}
          value={prefs.density}
          options={[
            { value: "comfortable", label: t("comfortable") },
            { value: "compact", label: t("compact") },
          ]}
          onChange={(density) => setPrefs((p) => ({ ...p, density }))}
        />
      </div>
      <button
        aria-pressed={prefs.sounds}
        onClick={() => setPrefs((p) => ({ ...p, sounds: !p.sounds }))}
      >
        {prefs.sounds ? <SpeakerHighIcon /> : <SpeakerSlashIcon />}
        {t("interfaceSounds")}: {t(prefs.sounds ? "on" : "off")}
      </button>
      <button
        aria-pressed={prefs.animatedBackgrounds}
        onClick={() =>
          setPrefs((p) => ({
            ...p,
            animatedBackgrounds: !p.animatedBackgrounds,
          }))
        }
      >
        <MonitorPlayIcon />
        {t("animatedBackgrounds")}:{" "}
        {t(prefs.animatedBackgrounds ? "on" : "off")}
      </button>
      {/* Xbox mode owns the window layout; the toggle only makes sense outside it. */}
      {xboxMode?.active !== true && (
        <button
          aria-pressed={!!fullscreen.data}
          aria-disabled={toggleFullscreen.isPending}
          onClick={() =>
            !toggleFullscreen.isPending &&
            toggleFullscreen.mutate(!fullscreen.data)
          }
        >
          <ArrowsOutIcon />
          {t("fullscreen")}: {t(fullscreen.data ? "on" : "off")}
        </button>
      )}
      {xboxMode && (
        <>
          <button
            aria-pressed={startup}
            aria-disabled={toggleStartup.isPending}
            onClick={() =>
              !toggleStartup.isPending && toggleStartup.mutate(!startup)
            }
          >
            <PowerIcon />
            {t("xboxModeStartup")}: {t(startup ? "on" : "off")}
          </button>
          <p className="muted">{t("xboxModeStartupNote")}</p>
          {xboxMode.active === true ? (
            <p className="muted">{t("xboxModeActive")}</p>
          ) : (
            xboxMode.home &&
            xboxMode.active === false && (
              <button
                onClick={() =>
                  void invoke("enter_xbox_mode").catch((error) =>
                    notify(serviceError(error)),
                  )
                }
              >
                <MonitorPlayIcon />
                {t("enterXboxMode")}
              </button>
            )
          )}
        </>
      )}
    </>
  );
}

type AppEntry = { id: string; name: string; kind: "steam" | "epic" | "custom" };
type Listing = {
  title: string;
  can_go_up: boolean;
  entries: { id: number; name: string; dir: boolean }[];
};

/**
 * Folder browser the controller drives: up/down move, A opens a folder or picks a
 * program, B goes up and closes at the top. The backend resolves every index.
 */
function FileBrowser({
  t,
  listing,
  onListing,
  onPick,
  onClose,
  notify,
}: {
  t: Translate;
  listing: Listing;
  onListing: (listing: Listing) => void;
  onPick: (id: number) => void;
  onClose: () => void;
  notify: Notify;
}) {
  const root = useRef<HTMLDivElement>(null);
  const go = useMutation({
    mutationFn: (id: number | null) =>
      id === null
        ? invoke<Listing>("browse_up")
        : invoke<Listing>("browse", { id }),
    onSuccess: onListing,
    onError: (error) => notify(serviceError(error)),
  });
  const up = () => (listing.can_go_up ? go.mutate(null) : onClose());
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus the first entry of every new listing.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("button")?.focus();
  }, [listing]);
  // While open, the controller talks only to the browser (App routes through pickerInput).
  useFeatureInput(pickerInput, (a) => {
    if (a === "b") up();
    else navigateControls(a, root.current);
  });
  return (
    <div ref={root} className="file-browser">
      <div className="file-browser-head">
        <button onClick={up}>
          <ArrowLeftIcon />
          {t("browseUp")}
        </button>
        <strong>{listing.title || t("browsePlaces")}</strong>
      </div>
      {listing.entries.length === 0 ? (
        <p className="muted">{t("browseEmpty")}</p>
      ) : (
        <ul className="item-list">
          {listing.entries.map((entry) => (
            <li key={entry.id}>
              <button
                aria-disabled={go.isPending}
                onClick={() =>
                  !go.isPending &&
                  (entry.dir ? go.mutate(entry.id) : onPick(entry.id))
                }
              >
                {entry.dir ? <FolderIcon /> : <AppWindowIcon />}
                {entry.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Launchers found on the device plus the user's own programs, opened from here. */
export function AppsSettings({ t, notify }: { t: Translate; notify: Notify }) {
  const queryClient = useQueryClient();
  const apps = useQuery({
    ...commandQuery<AppEntry[]>("apps_list"),
    enabled: isTauri(),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["apps_list"] });
    void queryClient.invalidateQueries({ queryKey: ["library", "installed"] });
  };
  const launch = useMutation({
    mutationFn: (app: AppEntry) => invoke("launch_app", { id: app.id }),
    onSuccess: (_, app) => notify("appOpened", { name: app.name }),
    onError: (error) => notify(serviceError(error)),
  });
  const [browsing, setBrowsing] = useState<Listing | null>(null);
  const open = useMutation({
    mutationFn: () => invoke<Listing>("browse", { id: null }),
    onSuccess: setBrowsing,
    onError: (error) => notify(serviceError(error)),
  });
  const add = useMutation({
    mutationFn: (id: number) => invoke<AppEntry>("add_app", { id }),
    onSuccess: (app) => {
      notify("appAdded", { name: app.name });
      setBrowsing(null);
      refresh();
    },
    onError: (error) => notify(serviceError(error)),
  });
  const remove = useMutation({
    mutationFn: (app: AppEntry) => invoke("remove_app", { id: app.id }),
    onSuccess: refresh,
    onError: (error) => notify(serviceError(error)),
  });
  const busy =
    launch.isPending || add.isPending || remove.isPending || open.isPending;
  if (browsing)
    return (
      <FileBrowser
        t={t}
        listing={browsing}
        onListing={setBrowsing}
        onPick={(id) => !add.isPending && add.mutate(id)}
        onClose={() => setBrowsing(null)}
        notify={notify}
      />
    );
  return (
    <>
      <p className="muted">{t("appsIntro")}</p>
      {apps.data && apps.data.length > 0 && (
        <ul className="item-list">
          {apps.data.map((app) => (
            <ItemRow key={app.id} name={app.name}>
              {/* Open first: Right from the name reaches it, Remove sits after. */}
              <button
                className="accent"
                aria-disabled={busy}
                onClick={() => !busy && launch.mutate(app)}
              >
                <PlayIcon weight="fill" />
                {t("openApp")}
              </button>
              {app.kind === "custom" && (
                <button
                  aria-disabled={busy}
                  onClick={() => !busy && remove.mutate(app)}
                >
                  <TrashIcon />
                  {t("removeApp")}
                </button>
              )}
            </ItemRow>
          ))}
        </ul>
      )}
      <button
        data-initial-focus
        disabled={!isTauri()}
        aria-disabled={busy}
        aria-busy={open.isPending}
        onClick={() => !busy && open.mutate()}
      >
        <PlusIcon weight="bold" />
        {t("addApp")}
      </button>
    </>
  );
}

type Found = { id: string; name: string };
type Paired = Found & { connected: boolean };

/**
 * Every controller in one place: the ones connected now (battery, and a rumble to tell which
 * is which), the Bluetooth ones Windows remembers (unpair), and pairing a new one.
 */
export function ControllerSettings({
  t,
  notify,
}: {
  t: Translate;
  notify: Notify;
}) {
  const controllers = usePower().data?.controllers ?? [];
  const paired = useQuery({
    ...commandQuery<Paired[]>("bluetooth_paired"),
    refetchInterval: 5000,
  });
  const identify = useMutation({
    mutationFn: (index: number) => invoke("identify_controller", { index }),
    onError: (error) => notify(serviceError(error)),
  });
  // Unpairing the controller in hand would strand the player: the first press only arms it.
  const [armed, setArmed] = useState<string>();
  const unpair = useMutation({
    mutationFn: (device: Paired) =>
      invoke("bluetooth_unpair", { id: device.id }).then(() => device),
    onSuccess: (device) => {
      notify("bluetoothUnpaired", { name: device.name });
      void paired.refetch();
    },
    onError: (error) => notify(serviceError(error)),
    onSettled: () => setArmed(undefined),
  });
  const scan = useMutation({
    mutationFn: () => invoke<Found[]>("bluetooth_scan"),
    onError: (error) => notify(serviceError(error)),
  });
  const pair = useMutation({
    mutationFn: (device: Found) =>
      invoke("bluetooth_pair", { id: device.id }).then(() => device),
    onSuccess: (device) => {
      notify("bluetoothPaired", { name: device.name });
      scan.reset();
    },
    onError: (error) => notify(serviceError(error)),
  });
  const busy = scan.isPending || pair.isPending;
  return (
    <>
      <section aria-label={t("controllersNow")}>
        <h2>{t("controllersNow")}</h2>
        {controllers.length === 0 ? (
          <p className="muted">{t("controllersNone")}</p>
        ) : (
          <ul className="item-list controller-list">
            {controllers.map((c) => (
              <ItemRow
                key={c.index}
                name={
                  <>
                    {t("controllerNumber", { index: String(c.index) })}
                    <small className="muted">
                      <ControllerCharge level={c.level} />
                      {c.level === "wired"
                        ? t("controller_wired")
                        : `${t("controllerWireless")} · ${t(`controller_${c.level}` as MessageKey)}`}
                    </small>
                  </>
                }
              >
                <button
                  aria-busy={
                    identify.isPending && identify.variables === c.index
                  }
                  onClick={() =>
                    !identify.isPending && identify.mutate(c.index)
                  }
                >
                  <VibrateIcon />
                  {t("controllerIdentify")}
                </button>
              </ItemRow>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t("bluetoothPairedHeading")}>
        <h2>{t("bluetoothPairedHeading")}</h2>
        {!paired.data?.length ? (
          <p className="muted">{t("bluetoothNonePaired")}</p>
        ) : (
          <ul className="item-list controller-list">
            {paired.data.map((device) => (
              <ItemRow
                key={device.id}
                name={
                  <>
                    {device.name}
                    <small className="muted">
                      {t(
                        device.connected
                          ? "bluetoothConnected"
                          : "bluetoothDisconnected",
                      )}
                    </small>
                  </>
                }
              >
                <button
                  aria-busy={
                    unpair.isPending && unpair.variables?.id === device.id
                  }
                  onBlur={() => armed === device.id && setArmed(undefined)}
                  onClick={() => {
                    if (unpair.isPending) return;
                    if (armed === device.id) unpair.mutate(device);
                    else setArmed(device.id);
                  }}
                >
                  <LinkBreakIcon />
                  {t(
                    unpair.isPending && unpair.variables?.id === device.id
                      ? "bluetoothUnpairing"
                      : armed === device.id
                        ? "bluetoothUnpairConfirm"
                        : "bluetoothUnpair",
                  )}
                </button>
              </ItemRow>
            ))}
          </ul>
        )}
      </section>
      <h2>{t("bluetoothPairNew")}</h2>
      <p className="muted">{t("bluetoothIntro")}</p>
      <button
        data-initial-focus
        className="accent"
        disabled={!isTauri()}
        aria-disabled={busy}
        aria-busy={scan.isPending}
        onClick={() => !busy && scan.mutate()}
      >
        <MagnifyingGlassIcon weight="bold" />
        {t(scan.isPending ? "bluetoothScanning" : "bluetoothScan")}
      </button>
      {scan.data && scan.data.length === 0 && (
        <p className="muted" role="status">
          {t("bluetoothNoneFound")}
        </p>
      )}
      {scan.data && scan.data.length > 0 && (
        <ul className="item-list">
          {scan.data.map((device) => (
            <ItemRow key={device.id} name={device.name}>
              <button
                aria-disabled={busy}
                aria-busy={pair.isPending && pair.variables?.id === device.id}
                onClick={() => !busy && pair.mutate(device)}
              >
                <BluetoothIcon />
                {t(
                  pair.isPending && pair.variables?.id === device.id
                    ? "bluetoothPairing"
                    : "bluetoothPair",
                )}
              </button>
            </ItemRow>
          ))}
        </ul>
      )}
      <button
        onClick={() =>
          void invoke("open_bluetooth_settings").catch((error) =>
            notify(serviceError(error)),
          )
        }
      >
        <ArrowSquareOutIcon />
        {t("bluetoothWindowsSettings")}
      </button>
    </>
  );
}

export function UpdateSettings({
  t,
  updates,
}: {
  t: Translate;
  updates: ReturnType<typeof useUpdates>;
}) {
  const { update, version } = updates;
  return (
    <>
      {version && <p>{t("installedVersion", { version })}</p>}
      {isTauri() && (
        <button onClick={() => void invoke("open_log").catch(() => undefined)}>
          <FileTextIcon />
          {t("openLog")}
        </button>
      )}
      <button
        aria-disabled={updates.checking || updates.installing}
        aria-busy={updates.checking || updates.installing}
        onClick={() => {
          if (updates.checking || updates.installing) return;
          if (update) updates.install();
          else void updates.check();
        }}
      >
        {update ? <DownloadSimpleIcon weight="bold" /> : <ArrowClockwiseIcon />}
        {updates.installing
          ? t("updating", { version: update?.version ?? "" })
          : updates.checking
            ? t("checkingUpdates")
            : update
              ? t("updateAvailable", { version: update.version })
              : t("checkUpdates")}
      </button>
    </>
  );
}
