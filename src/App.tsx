import { useMutation, useQuery } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence } from "motion/react";
import {
  type CSSProperties,
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CarouselCover, Cover } from "./components/Cover";
import { DialogFooter } from "./components/Dialog";
import { FavoriteIcon } from "./components/FavoriteIcon";
import { GameBackdrop } from "./components/GameBackdrop";
import { GamePreview } from "./components/GamePreview";
import { HeroInfo } from "./components/HeroInfo";
import { LaunchScreen } from "./components/LaunchScreen";
import { Loading } from "./components/Loading";
import { Picker } from "./components/Picker";
import { Scene } from "./components/Scene";
import { SofaIcon } from "./components/SofaIcon";
import {
  initialLang,
  type Lang,
  saveLang,
  type Translate,
  translator,
} from "./i18n";
import {
  activeFilters,
  categoryOptions,
  defaultFilters,
  filterGames,
  type Game,
  hero,
  launcherName,
  pageSizes,
  parsePreferences,
  tasteWeights,
  titleGroup,
} from "./library";
import { playSound, setSounds } from "./sounds";
import { type Action, useInput } from "./useInput";
import { useLibrary } from "./useLibrary";
import { useUpdates } from "./useUpdates";
import { useWishlist } from "./useWishlist";
import "./App.css";
import "@fontsource-variable/outfit";
import {
  AppWindowIcon,
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  BluetoothIcon,
  CaretLeftIcon,
  CaretRightIcon,
  GaugeIcon,
  GearSixIcon,
  GhostIcon,
  HardDrivesIcon,
  HouseIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  PowerIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
  StorefrontIcon,
  WifiHighIcon,
  WifiSlashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { categoryLabel, useCategories } from "./features/Categories";
import { Downloads } from "./features/Downloads";
import { FiltersDrawer, type FilterTab } from "./features/FiltersDrawer";
import {
  captureGameOrigin,
  GameDetails,
  type GameOrigin,
} from "./features/GameDetails";
import { Onboarding } from "./features/Onboarding";
import { PowerMenu, TopBatteries, usePower } from "./features/Power";
import { Search, type SettingsShortcut } from "./features/Search";
import {
  AppearanceSettings,
  AppsSettings,
  ControllerSettings,
  LibrarySettings,
  SettingsDialog,
  type SettingsPanel,
  UpdateSettings,
} from "./features/Settings";
import { Store, type StoreTab } from "./features/Store";
import {
  commandQuery,
  demo,
  desktop,
  glideIntoView,
  type InputRef,
  type Notify,
  navigateControls,
  navigateSpatial,
  pickerInput,
  serviceError,
  useOnline,
} from "./services";

const PAGES = ["home", "library", "store"] as const;
const pageIcons = {
  home: HouseIcon,
  library: SquaresFourIcon,
  store: StorefrontIcon,
};
const TABS = [
  "all",
  "favorites",
  "steam",
  "epic",
  "gog",
  "xbox",
  "custom",
] as const;
const preferencesKey = demo ? "sofa.demo.preferences" : "sofa.preferences";
const onboardingKey = "sofa.onboarding.done";
/** Whole gigabytes as Windows counts them (1024³), enough for a storage overview. */
const gb = (bytes: number) => String(Math.round(bytes / 1024 ** 3));
/** Ticks on its own so the clock doesn't re-render the whole library every 30 s. */
function Clock({ lang }: { lang: Lang }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <time>
      {now.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}
/** One library tile. Memoized: moving focus re-renders two tiles, not the whole grid. */
const Tile = memo(function Tile({
  game: g,
  index: i,
  current,
  presentation,
  percent,
  favorite,
  t,
  onFocus,
  onHover,
  onOpen,
}: {
  game: Game;
  index: number;
  current: boolean;
  presentation: "carousel" | "grid";
  percent: number | undefined;
  favorite: boolean;
  t: Translate;
  onFocus: (index: number) => void;
  onHover: (index: number) => void;
  onOpen: (game: Game, index: number) => void;
}) {
  return (
    <button
      className="tile"
      data-game-id={g.id}
      style={
        {
          "--i": i % 18,
          "--p": percent != null ? percent / 100 : undefined,
        } as CSSProperties
      }
      data-installed={g.installed}
      data-downloading={percent != null || undefined}
      aria-current={current}
      aria-label={`${g.title} · ${g.source === "custom" ? t("customApp") : launcherName(g.source)} · ${t(g.installed ? "installed" : "availableToInstall")}`}
      onFocus={() => onFocus(i)}
      onMouseEnter={() => onHover(i)}
      onClick={() => onOpen(g, i)}
      onTransitionEnd={(event) => {
        if (
          event.propertyName === "flex-basis" &&
          presentation === "carousel" &&
          current &&
          document.activeElement === event.currentTarget
        )
          glideIntoView(event.currentTarget);
      }}
    >
      {presentation === "carousel" ? (
        <CarouselCover game={g} active={current} />
      ) : (
        <Cover game={g} />
      )}
      {!g.installed &&
        (percent != null ? (
          <>
            <span className="install-mark installing">
              {t("installing", { percent: String(percent) })}
            </span>
            <span
              className="install-progress"
              style={{ width: `${percent}%` }}
            />
          </>
        ) : (
          <span className="install-mark">{t("installGame")}</span>
        ))}
      <span
        className="favorite-mark"
        role="img"
        aria-label={t("favorite")}
        hidden={!favorite}
      >
        <FavoriteIcon active={favorite} />
      </span>
    </button>
  );
});
/** Status text and button hints; the app footer and every open dialog draw it. */
function HintBar({
  status,
  hints,
  children,
}: {
  status: string;
  hints: [string, string][];
  children?: ReactNode;
}) {
  return (
    <>
      <span role="status">{status}</span>
      {children}
      <span className="hints">
        {hints.map(([button, label]) => (
          <span key={button}>
            <kbd>{button}</kbd> {label}
          </span>
        ))}
      </span>
    </>
  );
}
/** Home shows the latest games in a carousel; the Library tab has the rest. */
const homeTiles = 15;
const HOME_FILTERS = ["all", "games", "apps"] as const;
export default function App() {
  const [page, setPage] = useState<(typeof PAGES)[number] | "settings">("home");
  const [tabChoice, setTab] = useState<(typeof TABS)[number]>("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOrigin = useRef<DOMRect | undefined>(undefined);
  const searchInput: InputRef = useRef(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The drawer's two tabs: the (possibly long) category list, and the other filters.
  const [filterTab, setFilterTab] = useState<FilterTab>("categories");
  const [focus, setFocus] = useState(0);
  const [prefs, setPrefs] = useState(() =>
    parsePreferences(
      localStorage.getItem(preferencesKey),
      demo ? null : localStorage.getItem("recent"),
    ),
  );
  const [status, setStatus] = useState("");
  // Status lines are transient feedback; a stale "installing…" or error misleads later.
  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(""), 8000);
    return () => clearTimeout(id);
  }, [status]);
  const [lang, setLang] = useState(initialLang);
  const [details, setDetails] = useState<Game | null>(null);
  const detailOrigin = useRef<GameOrigin | null>(null);
  const detailInput: InputRef = useRef(null);
  const [settings, setSettings] = useState<SettingsPanel | null>(null);
  const [powerMenu, setPowerMenu] = useState(false);
  // The store's comparison dialog, for the hints only.
  const [storeModal, setStoreModal] = useState(false);
  const [storeTab, setStoreTab] = useState<StoreTab>("discover");
  const [launchScreen, setLaunchScreen] = useState<Game | null>(null);
  const [launchPreparing, setLaunchPreparing] = useState(false);
  // The launch screen stays until the game itself is in front. Losing focus isn't enough: the
  // launcher takes it first and Rust hands it back. Rust gives up after 90 s and says so too.
  useEffect(() => {
    if (!launchScreen) return;
    setLaunchPreparing(false);
    const done = () => setLaunchScreen(null);
    const timeout = setTimeout(done, 95_000);
    const settled = isTauri() ? listen("launch-settled", done) : undefined;
    const progress = isTauri()
      ? listen("launch-progress", () => setLaunchPreparing(true))
      : undefined;
    return () => {
      clearTimeout(timeout);
      settled?.then((unlisten) => unlisten());
      progress?.then((unlisten) => unlisten());
    };
  }, [launchScreen]);
  const powerInput: InputRef = useRef(null);
  const power = usePower();
  const [launching, setLaunching] = useState(false);
  const t = useMemo(() => translator(lang), [lang]);
  // Async work reads the current language here, so switching it doesn't rescan or re-check updates.
  const tRef = useRef(t);
  tRef.current = t;
  const grid = useRef<HTMLDivElement>(null);
  // Hovering a tile focuses it; only controller and keyboard moves scroll it into view.
  const hovered = useRef(false);
  const touchScrollStart = useRef<number | null>(null);
  const featureInput: InputRef = useRef(null);
  const launchBusy = useRef(false);
  const notify = useCallback<Notify>(
    (message, values) => setStatus(tRef.current(message, values)),
    [],
  );
  const library = useLibrary(notify);
  const updates = useUpdates(notify);
  const online = useOnline();
  // Expected download of an owned Steam game, from its store requirements.
  const sizeEstimate = useQuery({
    ...commandQuery<number | null>("game_size_estimate", {
      id: details?.id,
      title: details?.title,
    }),
    enabled: !!details && !details.installed && isTauri(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  // Fixed disks for the storage card; looked up again when the user comes back to Sofa.
  const storage = useQuery({
    ...commandQuery<{ name: string; total: number; available: number }[]>(
      "storage_status",
    ),
    enabled: page === "settings" && isTauri(),
    refetchOnWindowFocus: true,
  });
  const { update, install } = updates;
  const { games, loading, scanError } = library;
  const categories = useCategories(games, lang);
  // A failed rescan keeps the games it already has; say so instead of hiding them.
  useEffect(() => {
    if (scanError && games.length > 0)
      setStatus(tRef.current("scanFailed", { error: tRef.current(scanError) }));
  }, [scanError, games.length]);
  // Percent per game being downloaded, for the tiles.
  const downloading = Object.fromEntries(
    library.downloads.map((d) => [d.game.id, d.percent]),
  ) as Record<string, number | undefined>;
  // First run: installed games are found on their own; only when nothing turns up (and no
  // store account is connected) does Sofa offer to connect the stores. Once, for good.
  const [onboardingDone, setOnboardingDone] = useState(
    () => demo || localStorage.getItem(onboardingKey) === "1",
  );
  const [onboarding, setOnboarding] = useState(false);
  const { steam: steamAccount, epic: epicAccount } = library.accounts;
  const needsOnboarding =
    !onboardingDone &&
    library.scanned &&
    !library.scanError &&
    library.games.length === 0 &&
    !steamAccount.busy &&
    !epicAccount.busy &&
    !steamAccount.connected &&
    !epicAccount.connected;
  useEffect(() => {
    if (needsOnboarding) setOnboarding(true);
  }, [needsOnboarding]);
  const finishOnboarding = () => {
    localStorage.setItem(onboardingKey, "1");
    setOnboardingDone(true);
    setOnboarding(false);
  };
  // "You may also like" never suggests what the player already has.
  const ownedSteam = useMemo(
    () =>
      new Set(
        library.games
          .filter((g) => g.id.startsWith("steam:"))
          .map((g) => g.id.slice(6)),
      ),
    [library.games],
  );
  // A store opinion replaces any earlier one for the same game.
  const setOpinion = useCallback(
    (
      appId: string,
      opinion: "liked" | "notInterested" | null,
      title?: string,
    ) =>
      setPrefs((p) => ({
        ...p,
        liked: [
          ...p.liked.filter((id) => id !== appId),
          ...(opinion === "liked" ? [appId] : []),
        ],
        notInterested: [
          ...p.notInterested.filter((id) => id !== appId),
          ...(opinion === "notInterested" ? [appId] : []),
        ],
        opinionTitles: {
          ...Object.fromEntries(
            Object.entries(p.opinionTitles).filter(([id]) => id !== appId),
          ),
          ...(opinion && title ? { [appId]: title } : {}),
        },
      })),
    [],
  );
  // Settings brings hidden recommendations back one by one, or all at once.
  const showRecommendations = (appIds: string[]) =>
    setPrefs((p) => ({
      ...p,
      notInterested: p.notInterested.filter((id) => !appIds.includes(id)),
      opinionTitles: Object.fromEntries(
        Object.entries(p.opinionTitles).filter(([id]) => !appIds.includes(id)),
      ),
    }));
  // The store orders deals by these: the player's Steam titles weighted by play.
  const taste = useMemo(
    () => tasteWeights(library.games, prefs),
    [library.games, prefs],
  );
  // Store prices follow the language unless the user picked a region.
  const region =
    prefs.region ?? (lang === "pt-BR" ? "br" : lang === "es" ? "es" : "us");
  // Lives here, not in the Store: the Store's dot announces its price drops and free games.
  const wishlist = useWishlist(region, lang, page === "store");
  useEffect(() => saveLang(lang), [lang]);
  useEffect(() => {
    localStorage.setItem(preferencesKey, JSON.stringify(prefs));
  }, [prefs]);
  const availableTabs = useMemo(
    () =>
      TABS.filter(
        (value) =>
          value === "all" ||
          value === "favorites" ||
          games.some((game) => game.source === value),
      ),
    [games],
  );
  // Games per tab, as the tabs show them; hidden games don't count.
  const tabCounts = useMemo(() => {
    const hidden = new Set(prefs.hidden);
    const favorites = new Set(prefs.favorites);
    const counts: Partial<Record<(typeof TABS)[number], number>> = {};
    const add = (key: (typeof TABS)[number]) =>
      (counts[key] = (counts[key] ?? 0) + 1);
    for (const game of games)
      if (!hidden.has(game.id)) {
        add("all");
        add(game.source);
        if (favorites.has(game.id)) add("favorites");
      }
    return counts;
  }, [games, prefs.hidden, prefs.favorites]);
  // A source tab disappears when its last game does; fall back to "all" without an extra render.
  const tab = availableTabs.includes(tabChoice) ? tabChoice : "all";
  // Typing stays responsive with thousands of owned games; the grid catches up a frame later.
  const deferredQuery = useDeferredValue(query);
  // Home separates games from the player's own apps (emulators) once there are any.
  const [homeFilter, setHomeFilter] =
    useState<(typeof HOME_FILTERS)[number]>("all");
  const hasApps = (tabCounts.custom ?? 0) > 0;
  const homeTab = !hasApps
    ? "all"
    : homeFilter === "apps"
      ? "custom"
      : homeFilter;
  const visible = useMemo(
    () =>
      filterGames(
        games,
        prefs,
        page === "home" ? homeTab : tab,
        page === "home" ? "" : deferredQuery,
        page === "home",
        Date.now(),
        categories.catalog,
      ),
    [games, prefs, page, tab, deferredQuery, categories.catalog, homeTab],
  );
  const categoryChoices = useMemo(
    () =>
      categoryOptions(
        games.filter((g) => !prefs.hidden.includes(g.id)),
        prefs,
        categories.catalog,
      ).sort((a, b) =>
        categoryLabel(a.label, lang).localeCompare(
          categoryLabel(b.label, lang),
        ),
      ),
    [games, prefs, categories.catalog, lang],
  );
  useEffect(() => {
    if (!games.length || !categories.ready || categories.loading) return;
    const available = new Set(categoryChoices.map((c) => c.key));
    setPrefs((p) =>
      p.filters.categories.some((key) => !available.has(key))
        ? {
            ...p,
            filters: {
              ...p.filters,
              categories: p.filters.categories.filter((key) =>
                available.has(key),
              ),
            },
          }
        : p,
    );
  }, [games.length, categories.ready, categories.loading, categoryChoices]);
  const toggleCategory = (key: string) =>
    setPrefs((p) => ({
      ...p,
      filters: {
        ...p.filters,
        categories: p.filters.categories.includes(key)
          ? p.filters.categories.filter((c) => c !== key)
          : [...p.filters.categories, key],
      },
    }));
  // The grid shows a page of the library; Home's row only its first games.
  const [gridPage, setGridPage] = useState(0);
  const gridPages = Math.max(1, Math.ceil(visible.length / prefs.pageSize));
  const shownPage = Math.min(gridPage, gridPages - 1);
  const shown =
    page === "home"
      ? visible.slice(0, homeTiles)
      : visible.slice(
          shownPage * prefs.pageSize,
          (shownPage + 1) * prefs.pageSize,
        );
  const goToGridPage = (next: number, landOnFirst = false) => {
    if (next < 0 || next >= gridPages) return;
    setGridPage(next);
    setFocus(0);
    grid.current?.scrollTo({ top: 0 });
    if (landOnFirst) requestAnimationFrame(() => tileAt(0)?.focus());
  };
  const selected = shown[Math.min(focus, Math.max(0, shown.length - 1))];
  const preview = details ?? (page === "home" ? selected : undefined);
  useEffect(() => {
    if (!details) return;
    const current = games.find((game) => game.id === details.id);
    if (current && current.installed !== details.installed) setDetails(current);
  }, [games, details]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new tab, search, page or filter starts at the first tile.
  useEffect(() => {
    setFocus(0);
    setGridPage(0);
    // The controller follows: focus on a tile (or lost with the old tiles) moves to the first.
    const active = document.activeElement;
    if (active === document.body || active?.classList.contains("tile"))
      requestAnimationFrame(() => tileAt(0)?.focus());
  }, [tab, query, page, prefs.filters, prefs.sort, prefs.pageSize, homeTab]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: leaving the library closes its filters.
  useEffect(() => setFiltersOpen(false), [page]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new tab shows new controls; focus the first one.
  useEffect(() => {
    if (filtersOpen)
      document
        .querySelector<HTMLElement>(
          "[data-filter-panel] [data-tabpanel] :is(button:not(:disabled), input)",
        )
        ?.focus();
  }, [filtersOpen, filterTab]);
  useEffect(
    () => setFocus((f) => Math.min(f, Math.max(0, shown.length - 1))),
    [shown.length],
  );
  // Letter headings sit between tiles when sorting by title; index tiles, not children.
  const tileAt = useCallback(
    (i: number) => grid.current?.querySelectorAll<HTMLElement>(".tile")[i],
    [],
  );
  // Hiding or uninstalling the focused game removes its tile (and the dialog's return
  // target); put controller focus back on the grid instead of losing it to <body>.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing a dialog is a moment focus can drop.
  useEffect(() => {
    if (document.activeElement !== document.body) return;
    const tile = tileAt(Math.min(focus, shown.length - 1));
    tile?.focus();
  }, [shown.length, focus, tileAt, details, settings]);
  const focusTile = useCallback((i: number) => setFocus(i), []);
  const finishTouchScroll = useCallback((row: HTMLDivElement) => {
    if (touchScrollStart.current === null) return;
    touchScrollStart.current = null;
    const padding =
      Number.parseFloat(getComputedStyle(row).scrollPaddingLeft) || 0;
    const left = row.getBoundingClientRect().left + padding;
    const tiles = row.querySelectorAll<HTMLButtonElement>(".tile");
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    tiles.forEach((tile, i) => {
      const next = Math.abs(tile.getBoundingClientRect().left - left);
      if (next < distance) {
        nearest = i;
        distance = next;
      }
    });
    tiles[nearest]?.focus({ preventScroll: true });
  }, []);
  const hoverTile = useCallback((i: number) => {
    setFocus((f) => {
      // Only a real change of tile skips the scroll; hovering the same one changes nothing.
      if (f !== i) hovered.current = true;
      return i;
    });
  }, []);
  const openTile = useCallback((g: Game, i: number) => {
    detailOrigin.current = captureGameOrigin(g.id);
    setFocus(i);
    setDetails(g);
  }, []);
  useEffect(() => {
    if (hovered.current) {
      hovered.current = false;
      return;
    }
    const tile = tileAt(focus);
    // Home's row is a carousel: it glides only when the focused game would leave the screen.
    if (tile && !glideIntoView(tile))
      tile.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }, [focus, tileAt]);
  const toggleFavorite = (g: Game) =>
    setPrefs((p) => ({
      ...p,
      favorites: p.favorites.includes(g.id)
        ? p.favorites.filter((id) => id !== g.id)
        : [...p.favorites, g.id],
    }));
  const toggleHidden = (g: Game) => {
    const hiding = !prefs.hidden.includes(g.id);
    setPrefs((p) => ({
      ...p,
      hidden: hiding
        ? [...p.hidden, g.id]
        : p.hidden.filter((id) => id !== g.id),
    }));
    setDetails(null);
    // The tile disappears; say where it went.
    setStatus(t(hiding ? "gameHidden" : "gameRestored", { title: g.title }));
  };
  const closeDetails = () => {
    if (!document.querySelector("[data-uninstall-busy]")) setDetails(null);
  };
  const play = async (g: Game) => {
    if (!g.installed) return;
    if (launchBusy.current) return;
    if (demo) {
      // The preview shows the launch screen without starting anything.
      setLaunchScreen(g);
      return;
    }
    if (!isTauri()) {
      setStatus(t("browserPreview"));
      return;
    }
    launchBusy.current = true;
    setLaunching(true);
    // A launch failure returns to the library and its status footer.
    setDetails(null);
    setLaunchScreen(g);
    try {
      await invoke("launch", { id: g.id });
      setPrefs((p) => ({ ...p, recent: { ...p.recent, [g.id]: Date.now() } }));
      setStatus("");
    } catch (e) {
      setLaunchScreen(null);
      setStatus(
        t("launchFailed", { title: g.title, error: t(serviceError(e)) }),
      );
    } finally {
      launchBusy.current = false;
      setLaunching(false);
    }
  };
  const hudLaunch = useMutation({
    mutationFn: () => desktop("open_hud"),
    onError: (error) => notify(serviceError(error)),
  });
  // The HUD is Sofa's Xbox Game Bar widget: it shows over games too.
  const openHud = () => {
    if (!hudLaunch.isPending) hudLaunch.mutate();
  };
  // The Settings cards, by how often a player needs them, also offered by the search
  // (Spotlight-style).
  const settingsShortcuts: SettingsShortcut[] = [
    {
      id: "controllers",
      Icon: BluetoothIcon,
      label: t("controllers"),
      description: t("settingsControllersDescription"),
      open: () => setSettings("controllers"),
    },
    {
      id: "hud",
      Icon: GaugeIcon,
      label: t("hud"),
      description: t("settingsPerformanceDescription"),
      open: openHud,
    },
    {
      id: "library",
      Icon: SquaresFourIcon,
      label: t("librarySettings"),
      description: t("settingsLibraryDescription"),
      open: () => setSettings("library"),
    },
    {
      id: "storage",
      Icon: HardDrivesIcon,
      label: t("storage"),
      description: t("settingsStorageDescription"),
      external: true,
      open: () =>
        void desktop("open_storage_settings").catch((error) =>
          notify(serviceError(error)),
        ),
    },
    {
      id: "appearance",
      Icon: GearSixIcon,
      label: t("appearance"),
      description: t("settingsAppearanceDescription"),
      open: () => setSettings("appearance"),
    },
    {
      id: "apps",
      Icon: AppWindowIcon,
      label: t("apps"),
      description: t("settingsAppsDescription"),
      open: () => setSettings("apps"),
    },
    {
      id: "updates",
      Icon: ArrowRightIcon,
      label: t("updates"),
      description: update
        ? t("updateAvailable", { version: update.version })
        : t("settingsUpdatesDescription"),
      open: () => setSettings("updates"),
    },
  ];
  const installGame = async (game: Game) => {
    if (game.installed) return;
    if (demo || !isTauri()) {
      setStatus(t(demo ? "previewInstall" : "browserPreview"));
      return;
    }
    try {
      await invoke("install_owned_game", { id: game.id });
      library.watchInstall(game.id);
      setStatus(
        t("installRequested", {
          title: game.title,
          launcher: launcherName(game.source) ?? "Steam",
        }),
      );
    } catch (error) {
      setStatus(t(serviceError(error)));
    }
  };
  const closeFilters = () => {
    setFiltersOpen(false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(".filter-toggle")?.focus(),
    );
  };
  // Interface sounds: a tick only when focus actually moved, a pair on A and on B.
  useEffect(() => setSounds(prefs.sounds), [prefs.sounds]);
  useInput((a) => {
    const before = document.activeElement;
    onAction(a);
    if (a === "a") playSound("select");
    else if (a === "b") playSound("back");
    else if (document.activeElement !== before) playSound("move");
  });
  const onAction = (a: Action) => {
    if (pickerInput.current) {
      pickerInput.current(a);
      return;
    }
    if (launchScreen) {
      // Its only control is "Back to Sofa": A presses it, B means the same.
      if (a === "a" || a === "b") setLaunchScreen(null);
      return;
    }
    if (searchOpen) {
      searchInput.current?.(a);
      return;
    }
    if (onboarding) {
      if (a === "b") finishOnboarding();
      else navigateSpatial(a, document.querySelector("dialog[open]"));
      return;
    }
    if (
      a === "filters" &&
      page === "library" &&
      !settings &&
      !details &&
      !powerMenu
    ) {
      setFiltersOpen((open) => !open);
      return;
    }

    if (powerMenu) {
      powerInput.current?.(a);
      return;
    }
    // A confirmation (uninstall, sign out) takes the controller: B cancels it, one level.
    const confirm = document.querySelector(
      "[data-confirm]:not([inert], [inert] *)",
    );
    if (confirm) {
      if (a === "b")
        confirm
          .querySelector<HTMLButtonElement>("[data-confirm-cancel]")
          ?.click();
      else navigateControls(a, confirm);
      return;
    }
    if (a === "power") {
      if (!settings && !details) setPowerMenu(true);
      return;
    }
    const primary = document.querySelector(".primary-nav");
    if (a === "menu" && !document.querySelector("dialog[open]")) {
      if (details) {
        document.querySelector<HTMLButtonElement>(".game-back")?.focus();
        return;
      }
      (
        primary?.querySelector<HTMLElement>("button[aria-current='page']") ??
        document.querySelector<HTMLElement>(
          ".system-bar button[aria-current='page']",
        )
      )?.focus();
      return;
    }
    if (document.querySelector(".scene[inert]")) return;
    if (
      filtersOpen &&
      page === "library" &&
      !settings &&
      !details &&
      !["settings", "home"].includes(a)
    ) {
      if (a === "b") closeFilters();
      else if (a === "y") setPrefs((p) => ({ ...p, filters: defaultFilters }));
      else if (a === "lb" || a === "rb")
        setFilterTab((tab) =>
          tab === "categories" ? "options" : "categories",
        );
      else navigateSpatial(a, document.querySelector("[data-filter-panel]"));
      return;
    }
    if (a === "b") {
      if (details) {
        if (detailInput.current) detailInput.current("b");
        else closeDetails();
      } else if (settings) setSettings(null);
      else if (page === "library" || page === "settings") setPage("home");
      else if (page !== "home") featureInput.current?.(a);
      return;
    }
    if (details || settings) {
      if (details) detailInput.current?.(a);
      else navigateSpatial(a, document.querySelector("dialog[open]"));
      if (a === "x" && details) toggleFavorite(details);
      if (a === "y" && details) toggleHidden(details);
      return;
    }
    const featureDialog = document.querySelector("dialog[open]");
    if (featureDialog) {
      if (
        !["up", "down", "left", "right", "a", "lb", "rb"].includes(a) ||
        !navigateSpatial(a, featureDialog)
      )
        featureInput.current?.(a);
      return;
    }
    if (a === "settings") {
      setPage("settings");
      return;
    }
    if (a === "home") {
      setPage("home");
      return;
    }
    if (a === "lb" || a === "rb") {
      if (navigateSpatial(a, document.querySelector("main"))) return;
      if (page === "home" && hasApps) {
        setHomeFilter(
          (f) =>
            HOME_FILTERS[
              (HOME_FILTERS.indexOf(f) + (a === "lb" ? -1 : 1) + 3) % 3
            ],
        );
      } else if (page === "home") {
        setPage("library");
        setTab("all");
      } else if (page === "library") {
        setTab(
          (s) =>
            availableTabs[
              (Math.max(0, availableTabs.indexOf(s)) +
                (a === "lb" ? -1 : 1) +
                availableTabs.length) %
                availableTabs.length
            ],
        );
      } else featureInput.current?.(a);
      return;
    }
    if (["up", "down", "left", "right", "a"].includes(a)) {
      const initial = (
        page === "home" || page === "library"
          ? tileAt(focus)
          : document.querySelector("#content button")
      ) as HTMLElement | null;
      if (navigateSpatial(a, document.querySelector("main"), initial)) return;
    }
    if (page !== "home" && page !== "library" && !settings && !details) {
      featureInput.current?.(a);
      return;
    }
    // LT/RT turn the Library's pages, landing on the first game.
    if ((a === "lt" || a === "rt") && page === "library")
      goToGridPage(shownPage + (a === "lt" ? -1 : 1), true);
    if (a === "x" && selected) toggleFavorite(selected);
    if (a === "y") install();
  };
  // The library's collection title is its page heading; on Home the hero title is.
  const CollectionHeading = page === "library" ? "h1" : "h2";
  const hints: [string, string][] = launchScreen
    ? [["B", t("launchBack")]]
    : details
      ? [
          ["A", t("selectAction")],
          ["X", t("favorites")],
          [
            "Y",
            t(prefs.hidden.includes(details.id) ? "restoreGame" : "hideGame"),
          ],
          ["B", t("close")],
        ]
      : settings || powerMenu || storeModal || searchOpen
        ? [
            ["A", t("selectAction")],
            ...(storeModal
              ? ([["X", t("wishlist")]] as [string, string][])
              : []),
            ["B", t("close")],
          ]
        : filtersOpen && page === "library"
          ? [
              ["A", t("selectAction")],
              ["LB/RB", t("filterTabs")],
              ["Y", t("clearFilters")],
              ["B", t("close")],
            ]
          : [
              ["View", t("menu")],
              ["A", t("selectAction")],
              ...(page === "home" || page === "library"
                ? ([
                    ["X", t("favorites")],
                    [
                      "LB/RB",
                      t(page === "home" && hasApps ? "show" : "sources"),
                    ],
                    ...(page === "library" && gridPages > 1
                      ? [["LT/RT", t("pages")]]
                      : []),
                  ] as [string, string][])
                : page === "store"
                  ? ([
                      ...(storeTab === "calendar"
                        ? []
                        : [["X", t("wishlist")]]),
                      ["LB/RB", t("storeTabs")],
                      ...(storeTab === "discover"
                        ? [["LT/RT", t("pages")]]
                        : []),
                    ] as [string, string][])
                  : []),
              ...(page === "home"
                ? []
                : ([["B", t("home")]] as [string, string][])),
            ];
  return (
    <DialogFooter
      value={
        <div className="dialog-footer">
          <HintBar status={status} hints={hints} />
        </div>
      }
    >
      <main
        className={`page-${page} density-${prefs.density}${details ? " game-open" : ""}`}
      >
        <a className="skip-link" href={details ? "#game-details" : "#content"}>
          {t("skipContent")}
        </a>
        <GameBackdrop
          src={
            details
              ? hero(details)
              : page === "home" || page === "library"
                ? hero(selected)
                : undefined
          }
          previous={page === "home" ? hero(shown[focus - 1]) : undefined}
          next={page === "home" ? hero(shown[focus + 1]) : undefined}
        >
          {preview && online && prefs.animatedBackgrounds && (
            <GamePreview
              key={preview.id}
              game={preview}
              lang={lang}
              paused={!!launchScreen}
            />
          )}
        </GameBackdrop>
        <header className="app-header">
          <button
            className="brand"
            inert={!!details}
            onClick={() => setPage("home")}
            aria-label={`Sofa · ${t("home")}`}
          >
            <SofaIcon />
            <span className="brand-name">sofa</span>
          </button>
          <nav className="primary-nav" aria-label="Sofa" inert={!!details}>
            {PAGES.map((p) => {
              const Icon = pageIcons[p];
              return (
                <button
                  key={p}
                  className={
                    p === "store" && wishlist.unseen ? "has-update" : undefined
                  }
                  title={t(p)}
                  aria-label={
                    p === "store" && wishlist.unseen
                      ? `${t(p)} · ${t("storeNews")}`
                      : t(p)
                  }
                  aria-current={page === p ? "page" : undefined}
                  onClick={() => setPage(p)}
                >
                  <Icon weight={page === p ? "fill" : "regular"} />
                  <span>{t(p)}</span>
                </button>
              );
            })}
          </nav>
          <div className="system-bar">
            <button
              onClick={(event) => {
                searchOrigin.current =
                  event.currentTarget.getBoundingClientRect();
                setSearchOpen(true);
              }}
              aria-label={t("search")}
              aria-haspopup="dialog"
              aria-expanded={searchOpen}
              title={t("search")}
            >
              <MagnifyingGlassIcon />
            </button>
            <span
              className="network-status"
              data-offline={!online || undefined}
              role="status"
              title={t(online ? "online" : "offline")}
            >
              {online ? (
                <WifiHighIcon weight="bold" />
              ) : (
                <WifiSlashIcon weight="bold" />
              )}
              <span className={online ? "visually-hidden" : undefined}>
                {t(online ? "online" : "offline")}
              </span>
            </span>
            <TopBatteries
              t={t}
              data={power.data}
              onOpen={openHud}
              onControllers={() => setSettings("controllers")}
            />
            <button
              onClick={() => setPowerMenu(true)}
              aria-label={t("powerMenu")}
              title={t("powerMenu")}
            >
              <PowerIcon />
            </button>
            <Clock lang={lang} />
            <button
              className={update ? "has-update" : undefined}
              onClick={() => {
                setDetails(null);
                setPage("settings");
              }}
              aria-label={
                update
                  ? `${t("settings")} · ${t("updateAvailable", { version: update.version })}`
                  : t("settings")
              }
              aria-current={page === "settings" ? "page" : undefined}
              title={t("settings")}
            >
              <GearSixIcon />
            </button>
          </div>
        </header>
        <AnimatePresence mode="wait" initial={false}>
          <Scene key={page} inert={!!details}>
            {page === "library" && (
              <section className="library-toolbar">
                {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not form fields (<fieldset>). */}
                <div
                  className="source-tabs"
                  role="group"
                  aria-label={t("sources")}
                >
                  <kbd aria-hidden>LB</kbd>
                  {availableTabs.map((s) => (
                    <button
                      key={s}
                      aria-pressed={s === tab}
                      onClick={() => setTab(s)}
                    >
                      {s === "all"
                        ? t("allGames")
                        : s === "favorites"
                          ? t(s)
                          : s === "custom"
                            ? t("customGames")
                            : s === "xbox"
                              ? "Xbox"
                              : s === "gog"
                                ? "GOG"
                                : s === "steam"
                                  ? "Steam"
                                  : "Epic"}
                      <span>{tabCounts[s] ?? 0}</span>
                    </button>
                  ))}
                  <kbd aria-hidden>RB</kbd>
                </div>
                <div className="tools">
                  {query && (
                    <button
                      className="search-query"
                      onClick={() => setQuery("")}
                      aria-label={t("clearSearch")}
                    >
                      <XIcon />
                      {query}
                    </button>
                  )}
                  <button
                    className="filter-toggle"
                    aria-expanded={filtersOpen}
                    aria-controls="library-filters"
                    onClick={() => setFiltersOpen((open) => !open)}
                  >
                    <SlidersHorizontalIcon />
                    {t("filters")}
                    {activeFilters(prefs.filters) > 0 && (
                      <span>{activeFilters(prefs.filters)}</span>
                    )}
                  </button>
                </div>
                {prefs.filters.categories.length > 0 && (
                  // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not form fields (<fieldset>).
                  <div
                    className="active-categories"
                    role="group"
                    aria-label={t("activeCategories")}
                  >
                    {categoryChoices
                      .filter((c) => prefs.filters.categories.includes(c.key))
                      .map((c) => (
                        <button
                          key={c.key}
                          onClick={() => {
                            toggleCategory(c.key);
                            requestAnimationFrame(() =>
                              (
                                document.querySelector<HTMLElement>(
                                  ".active-categories button",
                                ) ??
                                document.querySelector<HTMLElement>(
                                  ".filter-toggle",
                                )
                              )?.focus(),
                            );
                          }}
                          aria-label={t("removeCategory", {
                            category: categoryLabel(c.label, lang),
                          })}
                        >
                          {categoryLabel(c.label, lang)}
                          <XIcon />
                        </button>
                      ))}
                  </div>
                )}
                {filtersOpen && (
                  <FiltersDrawer
                    t={t}
                    lang={lang}
                    prefs={prefs}
                    setPrefs={setPrefs}
                    tab={filterTab}
                    setTab={setFilterTab}
                    choices={categoryChoices}
                    categories={categories}
                    onToggleCategory={toggleCategory}
                    onClose={closeFilters}
                  />
                )}
              </section>
            )}
            {demo && <span className="preview-label">{t("preview")}</span>}
            {(page === "home" || page === "library") &&
              (loading ? (
                page === "library" ? (
                  // The grid is already on screen: tiles take shape where they will land.
                  <div
                    className="grid skeleton-grid"
                    role="status"
                    aria-label={t("scanning")}
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed, identical loading placeholders.
                      <div className="skeleton" key={i} />
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <Loading label={t("scanning")} />
                  </div>
                )
              ) : scanError && games.length === 0 ? (
                <div className="empty" role="alert">
                  <p>{t("scanFailed", { error: t(scanError) })}</p>
                  <button
                    data-initial-focus
                    onClick={() => void library.refresh()}
                  >
                    <ArrowClockwiseIcon />
                    {t("retry")}
                  </button>
                </div>
              ) : visible.length === 0 ? (
                <div className="empty">
                  <h1>
                    {page === "home"
                      ? t("library")
                      : tab === "favorites"
                        ? t(tab)
                        : t("allGames")}
                  </h1>
                  <p>
                    {query
                      ? t("noMatches")
                      : tab === "favorites" && page !== "home"
                        ? t("emptyFavorites")
                        : activeFilters(prefs.filters) > 0
                          ? t("filterNoMatches")
                          : page === "home" &&
                              games.some((game) => !game.installed)
                            ? t("homeNoInstalled")
                            : t("noGames")}
                  </p>
                  {/* Every empty state offers the way out, so A has something to press. */}
                  {query ? (
                    <button data-initial-focus onClick={() => setQuery("")}>
                      <XIcon />
                      {t("clearSearch")}
                    </button>
                  ) : page === "library" && activeFilters(prefs.filters) > 0 ? (
                    <button
                      data-initial-focus
                      onClick={() =>
                        setPrefs((p) => ({ ...p, filters: defaultFilters }))
                      }
                    >
                      <ArrowCounterClockwiseIcon />
                      {t("clearFilters")}
                    </button>
                  ) : page === "home" &&
                    games.some((game) => !game.installed) ? (
                    <button
                      data-initial-focus
                      onClick={() => setPage("library")}
                    >
                      <SquaresFourIcon />
                      {t("browseLibrary")}
                    </button>
                  ) : (
                    !games.length && (
                      <button
                        data-initial-focus
                        onClick={() => setSettings("library")}
                      >
                        <GearSixIcon />
                        {t("librarySettings")}
                      </button>
                    )
                  )}
                </div>
              ) : (
                <>
                  {page === "home" && selected && (
                    <HeroInfo
                      game={selected}
                      t={t}
                      lang={lang}
                      recent={prefs.recent[selected.id]}
                    >
                      <div className="hero-actions">
                        {/* Home lists installed games only. */}
                        <button
                          className="accent primary-action"
                          aria-disabled={launching}
                          aria-busy={launching}
                          onClick={() => void play(selected)}
                        >
                          <PlayIcon weight="fill" />
                          {t("play")}
                        </button>
                        <button
                          onClick={() => {
                            detailOrigin.current = captureGameOrigin(
                              selected.id,
                            );
                            setDetails(selected);
                          }}
                        >
                          <InfoIcon />
                          {t("details")}
                        </button>
                        <button
                          aria-pressed={prefs.favorites.includes(selected.id)}
                          onClick={() => toggleFavorite(selected)}
                        >
                          <FavoriteIcon
                            active={prefs.favorites.includes(selected.id)}
                          />
                          {t("favorites")}
                        </button>
                      </div>
                    </HeroInfo>
                  )}
                  <Downloads
                    t={t}
                    lang={lang}
                    downloads={library.downloads}
                    onStopTracking={library.stopWatchingInstall}
                  />
                  <section className="collection" id="content" tabIndex={-1}>
                    <div className="collection-heading">
                      <CollectionHeading>
                        {/* The title names what the row holds: apps are not games. */}
                        {page === "home"
                          ? t(
                              homeTab === "custom"
                                ? "customGames"
                                : !visible.some((g) => prefs.recent[g.id])
                                  ? "library"
                                  : homeTab === "all" && hasApps
                                    ? "recentItems"
                                    : "recentGames",
                            )
                          : t("filteredCount", {
                              installed: String(
                                visible.filter((game) => game.installed).length,
                              ),
                              total: String(visible.length),
                            })}
                      </CollectionHeading>
                      {page === "home" && hasApps && (
                        // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not form fields (<fieldset>).
                        <div
                          className="segmented home-filter"
                          role="group"
                          aria-label={t("show")}
                        >
                          {HOME_FILTERS.map((f) => (
                            <button
                              key={f}
                              aria-pressed={homeFilter === f}
                              onClick={() => setHomeFilter(f)}
                            >
                              {f === "all" ? (
                                <SquaresFourIcon aria-hidden />
                              ) : f === "games" ? (
                                <GhostIcon aria-hidden />
                              ) : (
                                <AppWindowIcon aria-hidden />
                              )}
                              {t(
                                f === "all"
                                  ? "showAll"
                                  : f === "games"
                                    ? "showGames"
                                    : "customGames",
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      {page === "library" && (
                        <div className="collection-actions">
                          {/* Sorting sits right above the list it orders; UP from the list brings focus here. */}
                          <Picker
                            label={t("sort")}
                            value={prefs.sort}
                            options={[
                              { value: "recent", label: t("recent") },
                              {
                                value: "mostPlayed",
                                label: t("sortMostPlayed"),
                              },
                              {
                                value: "installed",
                                label: t("sortInstalled"),
                              },
                              { value: "title", label: t("titleAsc") },
                              { value: "size", label: t("sortSize") },
                            ]}
                            onChange={(sort) =>
                              setPrefs((p) => ({ ...p, sort }))
                            }
                          />
                        </div>
                      )}
                    </div>
                    {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not form fields (<fieldset>). */}
                    <div
                      className={page === "home" ? "game-row" : "grid"}
                      data-carousel={page === "home" || undefined}
                      data-up={page === "home" ? ".primary-action" : undefined}
                      ref={grid}
                      role="group"
                      aria-label={t("library")}
                      onTouchStart={(event) => {
                        if (page === "home")
                          touchScrollStart.current =
                            event.currentTarget.scrollLeft;
                      }}
                      onTouchEnd={(event) => {
                        if (
                          touchScrollStart.current ===
                          event.currentTarget.scrollLeft
                        )
                          touchScrollStart.current = null;
                      }}
                      onTouchCancel={() => {
                        touchScrollStart.current = null;
                      }}
                      onScrollEnd={(event) => {
                        if (page === "home")
                          finishTouchScroll(event.currentTarget);
                      }}
                    >
                      {shown.map((g, i) => (
                        <Fragment key={g.id}>
                          {page === "library" &&
                            prefs.sort === "title" &&
                            (i === 0 ||
                              titleGroup(shown[i - 1].title) !==
                                titleGroup(g.title)) && (
                              <h3 className="grid-letter">
                                {titleGroup(g.title)}
                              </h3>
                            )}
                          <Tile
                            game={g}
                            index={i}
                            current={i === focus}
                            presentation={page === "home" ? "carousel" : "grid"}
                            percent={downloading[g.id]}
                            favorite={prefs.favorites.includes(g.id)}
                            t={t}
                            onFocus={focusTile}
                            onHover={hoverTile}
                            onOpen={openTile}
                          />
                        </Fragment>
                      ))}
                    </div>
                    {/* Page size on the left, the pages on the right; LT/RT turn them too. */}
                    {page === "library" && visible.length > pageSizes[0] && (
                      <div className="library-pager">
                        <div className="page-size">
                          <span aria-hidden>{t("perPage")}</span>
                          <Picker
                            label={t("perPage")}
                            value={String(prefs.pageSize)}
                            options={pageSizes.map((size) => ({
                              value: String(size),
                              label: String(size),
                            }))}
                            onChange={(size) =>
                              setPrefs((p) => ({
                                ...p,
                                pageSize: Number(size) as typeof p.pageSize,
                              }))
                            }
                          />
                        </div>
                        {gridPages > 1 && (
                          <nav
                            className="store-pager"
                            aria-label={t("pageOf", {
                              page: String(shownPage + 1),
                              pages: String(gridPages),
                            })}
                          >
                            <button
                              disabled={shownPage === 0}
                              onClick={() => goToGridPage(shownPage - 1)}
                            >
                              <CaretLeftIcon weight="bold" />
                              {t("previousPage")}
                            </button>
                            <span>
                              {t("pageOf", {
                                page: String(shownPage + 1),
                                pages: String(gridPages),
                              })}
                            </span>
                            <button
                              disabled={shownPage + 1 >= gridPages}
                              onClick={() => goToGridPage(shownPage + 1)}
                            >
                              {t("nextPage")}
                              <CaretRightIcon weight="bold" />
                            </button>
                          </nav>
                        )}
                      </div>
                    )}
                  </section>
                </>
              ))}
            {page === "store" && (
              <Store
                t={t}
                lang={lang}
                region={region}
                owned={ownedSteam}
                taste={taste}
                saved={wishlist}
                opinions={prefs}
                onOpinion={setOpinion}
                steamConnected={library.accounts.steam.connected}
                onModal={setStoreModal}
                onTab={setStoreTab}
                notify={notify}
                input={featureInput}
                onBack={() => setPage("home")}
              />
            )}
            {page === "settings" && (
              <section className="settings-hub" id="content" tabIndex={-1}>
                <div className="settings-hub-heading">
                  <p className="eyebrow">
                    <SofaIcon size={36} />
                    {updates.version ? `Sofa ${updates.version}` : "Sofa"}
                  </p>
                  <h1>{t("settings")}</h1>
                  <p>{t("settingsHubIntro")}</p>
                </div>
                <div className="settings-hub-grid">
                  {settingsShortcuts.map(
                    ({ id, Icon, label, description, external, open }) => (
                      <button
                        key={id}
                        className={
                          id === "updates" && update ? "has-update" : undefined
                        }
                        onClick={open}
                      >
                        <Icon aria-hidden />
                        {external && (
                          <ArrowSquareOutIcon
                            className="external"
                            aria-hidden
                          />
                        )}
                        <strong>{label}</strong>
                        <span>
                          {id === "storage" && storage.data?.length
                            ? storage.data.map((disk) => (
                                <Fragment key={disk.name}>
                                  {t("storageFree", {
                                    name: disk.name,
                                    free: gb(disk.available),
                                    total: gb(disk.total),
                                  })}
                                  <br />
                                </Fragment>
                              ))
                            : description}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </section>
            )}
          </Scene>
        </AnimatePresence>
        <footer>
          <HintBar
            status={status || (!isTauri() && !demo ? t("browserPreview") : "")}
            hints={hints}
          >
            {update && (
              <button
                className="update"
                aria-disabled={updates.installing}
                aria-busy={updates.installing}
                onClick={install}
              >
                {/* Y installs it only where nothing else claims Y. */}
                {(page === "home" || page === "library") &&
                  !details &&
                  !filtersOpen && <kbd>Y</kbd>}
                {updates.installing
                  ? t("updating", { version: update.version })
                  : t("updateAvailable", { version: update.version })}
              </button>
            )}
          </HintBar>
        </footer>
        {launchScreen && (
          <LaunchScreen
            game={launchScreen}
            preparing={launchPreparing}
            t={t}
            onBack={() => setLaunchScreen(null)}
          />
        )}
        {searchOpen && (
          <Search
            origin={searchOrigin.current}
            games={games}
            prefs={prefs}
            initialQuery={query}
            loading={loading}
            t={t}
            lang={lang}
            input={searchInput}
            settings={settingsShortcuts}
            onSetting={(shortcut) => {
              setSearchOpen(false);
              shortcut.open();
            }}
            onClose={() => setSearchOpen(false)}
            onOpen={(game) => {
              detailOrigin.current = captureGameOrigin(game.id);
              setSearchOpen(false);
              setDetails(game);
            }}
            onBrowse={(search) => {
              setSearchOpen(false);
              setQuery(search);
              setTab("all");
              setPrefs((p) => ({ ...p, filters: defaultFilters }));
              setPage("library");
            }}
          />
        )}
        {powerMenu && (
          <PowerMenu
            t={t}
            data={power.data}
            input={powerInput}
            onClose={() => setPowerMenu(false)}
          />
        )}
        {details && (
          <GameDetails
            key={details.id}
            origin={detailOrigin.current}
            input={detailInput}
            game={details}
            t={t}
            lang={lang}
            prefs={prefs}
            sizeEstimate={sizeEstimate.data}
            launching={launching}
            onPlay={(game) => void play(game)}
            onInstall={(game) => void installGame(game)}
            onToggleFavorite={toggleFavorite}
            onToggleHidden={toggleHidden}
            onUninstalled={() => {
              void library.refresh();
              setDetails(null);
              setStatus(t("uninstallComplete"));
            }}
            onClose={closeDetails}
          />
        )}
        {onboarding && (
          <Onboarding t={t} library={library} onDone={finishOnboarding} />
        )}
        {settings && (
          <SettingsDialog
            panel={settings}
            t={t}
            onClose={() => setSettings(null)}
          >
            {settings === "library" && (
              <LibrarySettings
                t={t}
                library={library}
                prefs={prefs}
                onRestore={toggleHidden}
                onShowRecommendations={showRecommendations}
              />
            )}
            {settings === "appearance" && (
              <AppearanceSettings
                t={t}
                lang={lang}
                setLang={setLang}
                region={region}
                prefs={prefs}
                setPrefs={setPrefs}
                notify={notify}
              />
            )}
            {settings === "apps" && <AppsSettings t={t} notify={notify} />}
            {settings === "controllers" && (
              <ControllerSettings t={t} notify={notify} />
            )}
            {settings === "updates" && (
              <UpdateSettings t={t} updates={updates} />
            )}
          </SettingsDialog>
        )}
      </main>
    </DialogFooter>
  );
}
