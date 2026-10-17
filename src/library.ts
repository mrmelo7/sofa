export type Game = {
  id: string;
  title: string;
  source: "steam" | "epic" | "gog" | "xbox" | "custom";
  launch: string;
  cover: string | null;
  installed: boolean;
  /** Unix seconds of the launcher's last recorded session (Steam). */
  last_played?: number;
  /** Total minutes played, as Steam counts it. */
  playtime?: number;
  /** Bytes on disk, when the launcher's manifest records it. */
  size?: number;
};
export type PendingInstall = { id: string; started: number };
export const pendingLifetime = 7 * 24 * 60 * 60 * 1000;
export function parsePendingInstalls(
  raw: string | null,
  now = Date.now(),
): PendingInstall[] {
  try {
    const entries: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(entries)) return [];
    const seen = new Set<string>();
    return entries.filter((entry): entry is PendingInstall => {
      if (
        entry == null ||
        typeof entry !== "object" ||
        typeof entry.id !== "string" ||
        entry.id.length > 128 ||
        !/^(steam|gog):\d+$|^epic:[A-Za-z0-9._-]+$/.test(entry.id) ||
        typeof entry.started !== "number" ||
        !Number.isFinite(entry.started) ||
        entry.started > now ||
        now - entry.started >= pendingLifetime ||
        seen.has(entry.id)
      )
        return false;
      seen.add(entry.id);
      return true;
    });
  } catch {
    return [];
  }
}
export function mergeLibrary(installed: Game[], owned: Game[]): Game[] {
  const merged = new Map<string, Game>();
  for (const game of owned) merged.set(game.id, { ...game, installed: false });
  for (const game of installed) {
    const account = merged.get(game.id);
    merged.set(game.id, {
      ...account,
      ...game,
      cover: game.cover ?? account?.cover ?? null,
      installed: true,
    });
  }
  return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title));
}
/** Hours with one decimal from Steam's minutes; nothing under six minutes. */
/** A number with exactly `digits` decimals, in the language's own way (1.5 / 1,5). */
const decimals = (value: number, digits: number, lang: string) =>
  new Intl.NumberFormat(lang, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
export const hoursPlayed = (minutes: number, lang: string) =>
  minutes >= 6
    ? `${decimals(minutes / 60, minutes >= 600 ? 0 : 1, lang)} h`
    : "";
/** One decimal above a gigabyte, whole megabytes below. */
export const formatSize = (bytes: number, lang: string) =>
  bytes >= 1024 ** 3
    ? `${decimals(bytes / 1024 ** 3, 1, lang)} GB`
    : `${decimals(bytes / 1024 ** 2, 0, lang)} MB`;
/** One line of facts under a title: last session, hours, size on disk or to download. */
export function gameMeta(
  game: Game,
  t: (
    key:
      | "lastPlayed"
      | "neverPlayed"
      | "hoursPlayed"
      | "diskSpaceUsed"
      | "downloadEstimate",
    vars?: Record<string, string>,
  ) => string,
  lang: string,
  lastAt?: number,
  estimate?: number,
): string {
  return [
    lastAt
      ? t("lastPlayed", { date: new Date(lastAt).toLocaleDateString(lang) })
      : // An uninstalled game says what it is instead (`game_media`).
        game.installed
        ? t("neverPlayed")
        : "",
    game.playtime
      ? t("hoursPlayed", { hours: hoursPlayed(game.playtime, lang) })
      : "",
    game.installed && game.size != null
      ? t("diskSpaceUsed", { size: formatSize(game.size, lang) })
      : estimate != null
        ? t("downloadEstimate", { size: formatSize(estimate, lang) })
        : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
type FactKey =
  | "factDeveloper"
  | "factReleased"
  | "factMetacritic"
  | "factPlayed"
  | "factLastPlayed"
  | "factSize"
  | "factDownload";
/** Labelled facts for the open game's strip; anything unknown is left out. */
export function gameFacts(
  game: Game,
  steam:
    | {
        developer?: string | null;
        released?: number | null;
        metacritic?: number | null;
      }
    | undefined,
  p: Pick<Preferences, "recent">,
  lang: string,
  estimate?: number,
  now = Date.now(),
): [FactKey, string][] {
  const last = Math.max(p.recent[game.id] ?? 0, (game.last_played ?? 0) * 1000);
  const sameYear = new Date(last).getFullYear() === new Date(now).getFullYear();
  const facts: [FactKey, string][] = [
    ["factDeveloper", steam?.developer ?? ""],
    ["factReleased", steam?.released ? String(steam.released) : ""],
    ["factMetacritic", steam?.metacritic ? String(steam.metacritic) : ""],
    ["factPlayed", game.playtime ? hoursPlayed(game.playtime, lang) : ""],
    [
      "factLastPlayed",
      last
        ? new Date(last).toLocaleDateString(lang, {
            day: "numeric",
            month: "short",
            year: sameYear ? undefined : "numeric",
          })
        : "",
    ],
    game.installed
      ? ["factSize", game.size != null ? formatSize(game.size, lang) : ""]
      : ["factDownload", estimate != null ? formatSize(estimate, lang) : ""],
  ];
  return facts.filter(([, value]) => value);
}
export type Similar = { appId: string; name: string };
/** Steam user tags per app id, with how strongly players applied each. */
export type TagWeights = Record<string, { tagid: number; weight: number }[]>;
/**
 * How much each Steam title says about the player's taste: hours played (log-scaled, so one
 * huge game doesn't drown the rest), recent sessions and favourites.
 */
export function tasteWeights(
  games: Game[],
  p: Pick<Preferences, "favorites" | "recent"> &
    Partial<Pick<Preferences, "liked" | "notInterested">>,
  now = Date.now(),
  limit = 40,
): { appId: string; weight: number }[] {
  const favorites = new Set(p.favorites);
  const owned = games
    .filter((g) => /^steam:\d+$/.test(g.id))
    .map((g) => {
      const last = Math.max(p.recent[g.id] ?? 0, (g.last_played ?? 0) * 1000);
      const days = last ? (now - last) / 86_400_000 : Number.POSITIVE_INFINITY;
      return {
        appId: g.id.slice(6),
        weight:
          Math.log1p(g.playtime ?? 0) +
          (days <= 30 ? 3 : days <= 180 ? 1 : 0) +
          (favorites.has(g.id) ? 4 : 0),
      };
    })
    .filter((g) => g.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
  const counted = new Set(owned.map((g) => g.appId));
  // The store's thumbs: a liked game counts like a favorite, one the player isn't interested
  // in pulls its kind of game back. The latest 30 of each (Steam's tag lookup takes 100 ids).
  return [
    ...owned,
    ...(p.liked ?? [])
      .slice(-30)
      .filter((id) => !counted.has(id))
      .map((appId) => ({ appId, weight: 4 })),
    ...(p.notInterested ?? [])
      .slice(-30)
      .map((appId) => ({ appId, weight: -4 })),
  ];
}
/** A title's tags as shares of its own total weight, so long tag lists don't count double. */
function shares(tags: TagWeights[string] | undefined) {
  const total = tags?.reduce((sum, t) => sum + t.weight, 0) ?? 0;
  return total
    ? (tags ?? []).map((t) => [t.tagid, t.weight / total] as const)
    : [];
}
/** The player's taste as a weight per Steam tag. */
export function tasteProfile(
  weights: { appId: string; weight: number }[],
  tags: TagWeights,
): Map<number, number> {
  const profile = new Map<number, number>();
  for (const { appId, weight } of weights)
    for (const [tagid, share] of shares(tags[appId]))
      profile.set(tagid, (profile.get(tagid) ?? 0) + weight * share);
  return profile;
}
/**
 * Items closest to the player's taste first; ties and items with nothing in common (or no
 * Steam id) keep their original order behind them.
 */
export function byTaste<T extends { steamAppID: string | null }>(
  items: T[],
  profile: Map<number, number>,
  tags: TagWeights,
): T[] {
  if (!profile.size) return items;
  const score = (item: T) =>
    shares(item.steamAppID ? tags[item.steamAppID] : undefined).reduce(
      (sum, [tagid, share]) => sum + share * (profile.get(tagid) ?? 0),
      0,
    );
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
/** Heading for a title-sorted group: its first letter, or "#" for digits and symbols. */
export function titleGroup(title: string): string {
  const first = title.trim().charAt(0).toLocaleUpperCase();
  return /\p{L}/u.test(first) ? first : "#";
}
export type LibraryFilters = {
  categories: string[];
  favoritesOnly: boolean;
  played: "any" | "never" | "recent7" | "recent30";
  artwork: "any" | "with" | "without";
};
/** Steam store regions the price lookup accepts; the backend holds the same list. */
export const regions = ["us", "br", "es", "mx", "ar", "pt"] as const;
export type Region = (typeof regions)[number];
export type Preferences = {
  favorites: string[];
  hidden: string[];
  recent: Record<string, number>;
  sort: "recent" | "mostPlayed" | "installed" | "title" | "size";
  density: "comfortable" | "compact";
  /** Games per Library page. */
  pageSize: (typeof pageSizes)[number];
  /** Unset means "follow the language" (see App). */
  region?: Region;
  filters: LibraryFilters;
  categories: Record<string, string[]>;
  /** Steam app ids liked in the store, and ones the player isn't interested in (never shown). */
  liked: string[];
  notInterested: string[];
  /** Names of those games, so Settings can list what was hidden. */
  opinionTitles: Record<string, string>;
  /** Interface sounds (moving focus, A, B). */
  sounds: boolean;
  /** Muted game previews behind Home and the full-screen game page. */
  animatedBackgrounds: boolean;
};
export const pageSizes = [15, 30, 60] as const;
const sorts: Preferences["sort"][] = [
  "recent",
  "mostPlayed",
  "installed",
  "title",
  "size",
];
export const defaultFilters: LibraryFilters = {
  categories: [],
  favoritesOnly: false,
  played: "any",
  artwork: "any",
};
export const defaults: Preferences = {
  favorites: [],
  hidden: [],
  recent: {},
  sort: "recent",
  density: "comfortable",
  pageSize: 15,
  filters: defaultFilters,
  categories: {},
  liked: [],
  notInterested: [],
  opinionTitles: {},
  sounds: true,
  animatedBackgrounds: true,
};
const ids = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string"))]
    : [];
/** Steam app ids only, oldest first, the latest 500 kept. */
const steamIds = (v: unknown): string[] =>
  ids(v)
    .filter((id) => /^\d{1,10}$/.test(id))
    .slice(-500);
export function parsePreferences(
  raw: string | null,
  legacyRecent: string | null = null,
): Preferences {
  let p: Partial<Preferences> = {};
  try {
    const value = JSON.parse(raw ?? "{}");
    if (value && typeof value === "object") p = value;
  } catch {
    /* Recover corrupt settings. */
  }
  let recent: unknown = p.recent;
  if (!recent) {
    try {
      recent = JSON.parse(legacyRecent ?? "{}");
    } catch {
      recent = {};
    }
  }
  const f =
    p.filters && typeof p.filters === "object" ? p.filters : defaultFilters;
  const liked = steamIds(p.liked);
  const notInterested = steamIds(p.notInterested);
  const judged = new Set([...liked, ...notInterested]);
  return {
    favorites: ids(p.favorites),
    hidden: ids(p.hidden),
    liked,
    notInterested,
    sounds: p.sounds !== false,
    animatedBackgrounds: p.animatedBackgrounds !== false,
    opinionTitles: Object.fromEntries(
      Object.entries(
        p.opinionTitles && typeof p.opinionTitles === "object"
          ? p.opinionTitles
          : {},
      ).filter(
        ([id, title]) =>
          judged.has(id) &&
          typeof title === "string" &&
          title.trim() !== "" &&
          title.length <= 200,
      ),
    ),
    recent: Object.fromEntries(
      Object.entries(recent && typeof recent === "object" ? recent : {}).filter(
        ([, v]) => typeof v === "number" && Number.isFinite(v) && v > 0,
      ),
    ),
    sort: sorts.find((sort) => sort === p.sort) ?? "recent",
    density: p.density === "compact" ? "compact" : "comfortable",
    pageSize: pageSizes.find((size) => size === p.pageSize) ?? 15,
    ...(regions.includes(p.region as Region)
      ? { region: p.region as Region }
      : {}),
    categories: Object.fromEntries(
      Object.entries(
        p.categories && typeof p.categories === "object" ? p.categories : {},
      ).map(([id, labels]) => [id, cleanCategories(labels)]),
    ),
    filters: {
      categories: cleanCategories(f.categories).map(categoryKey),
      favoritesOnly: f.favoritesOnly === true,
      played: ["never", "recent7", "recent30"].includes(f.played)
        ? f.played
        : "any",
      artwork:
        f.artwork === "with" || f.artwork === "without" ? f.artwork : "any",
    },
  };
}
export const activeFilters = (f: LibraryFilters) =>
  f.categories.length +
  Number(f.favoritesOnly) +
  Number(f.played !== "any") +
  Number(f.artwork !== "any");
export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
export function filterGames(
  games: Game[],
  p: Preferences,
  tab: string,
  query: string,
  home = false,
  now = Date.now(),
  catalog: CategoryMap = {},
): Game[] {
  const q = fold(query.trim());
  const f = home ? defaultFilters : p.filters;
  // Built once per call: libraries can hold thousands of owned games.
  const hidden = new Set(p.hidden);
  const favorites = new Set(p.favorites);
  const wanted = new Set(f.categories);
  return games
    .filter((g) => {
      if (home && !g.installed) return false;
      if (
        hidden.has(g.id) ||
        !(
          tab === "all" ||
          (tab === "favorites" ? favorites.has(g.id) : g.source === tab)
        ) ||
        (q !== "" && !fold(g.title).includes(q))
      )
        return false;
      if (
        wanted.size &&
        !gameCategories(g.id, p, catalog).some((label) =>
          wanted.has(categoryKey(label)),
        )
      )
        return false;
      if (f.favoritesOnly && !favorites.has(g.id)) return false;
      const played = lastPlayed(g, p);
      if (f.played === "never" && played) return false;
      if (f.played === "recent7" || f.played === "recent30") {
        const days = f.played === "recent7" ? 7 : 30;
        if (!played || played > now || played < now - days * 86400000)
          return false;
      }
      if (
        (f.artwork === "with" && !g.cover) ||
        (f.artwork === "without" && g.cover)
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      const byTitle = a.title.localeCompare(b.title);
      if (home || p.sort === "recent")
        return lastPlayed(b, p) - lastPlayed(a, p) || byTitle;
      switch (p.sort) {
        case "mostPlayed":
          return (b.playtime ?? 0) - (a.playtime ?? 0) || byTitle;
        case "installed":
          return Number(b.installed) - Number(a.installed) || byTitle;
        // Biggest first, to free space; games without a known size go last.
        case "size":
          return (b.size ?? -1) - (a.size ?? -1) || byTitle;
        default:
          return byTitle;
      }
    });
}
/** Milliseconds of the latest session: a launch from Sofa or one the launcher recorded. */
const lastPlayed = (g: Game, p: Preferences) =>
  Math.max(p.recent[g.id] ?? 0, (g.last_played ?? 0) * 1000);
export function hero(g: Game | undefined): string | undefined {
  if (!g) return;
  return g.source === "steam"
    ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.id.split(":")[1]}/library_hero.jpg`
    : (g.cover ?? undefined);
}

export type CategoryMap = Record<string, string[]>;
export const categoryKey = (label: string) =>
  fold(label).replace(/[^\p{L}\p{N}]/gu, "");
export function cleanCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const found = new Map<string, string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const label = item.trim().replace(/\s+/g, " ");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
    if (!label || label.length > 60 || /[\u0000-\u001f]/.test(label)) continue;
    if (!found.has(categoryKey(label))) found.set(categoryKey(label), label);
    if (found.size >= 40) break;
  }
  return [...found.values()];
}
export function gameCategories(
  id: string,
  p: Preferences,
  catalog: CategoryMap,
): string[] {
  return cleanCategories([...(catalog[id] ?? []), ...(p.categories[id] ?? [])]);
}
export function categoryOptions(
  games: Game[],
  p: Preferences,
  catalog: CategoryMap,
) {
  const options = new Map<
    string,
    { key: string; label: string; count: number }
  >();
  for (const game of games)
    for (const label of gameCategories(game.id, p, catalog)) {
      const key = categoryKey(label);
      const option = options.get(key) ?? { key, label, count: 0 };
      option.count++;
      options.set(key, option);
    }
  return [...options.values()];
}
