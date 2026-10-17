import assert from "node:assert/strict";
import { test } from "node:test";
import {
  byTaste,
  categoryOptions,
  cleanCategories,
  defaults,
  filterGames,
  formatSize,
  type Game,
  gameFacts,
  hoursPlayed,
  mergeLibrary,
  parsePendingInstalls,
  parsePreferences,
  tasteProfile,
  tasteWeights,
  titleGroup,
} from "../src/library.ts";

const games: Game[] = [
  {
    id: "steam:1",
    title: "Portal",
    source: "steam",
    installed: true,
    launch: "steam://rungameid/1",
    cover: null,
  },
  {
    id: "epic:2",
    title: "Hades",
    source: "epic",
    launch: "",
    cover: null,
    installed: true,
  },
  {
    id: "gog:3",
    title: "Cyberpunk",
    source: "gog",
    launch: "",
    cover: null,
    installed: true,
  },
];
test("pending downloads survive a restart but discard stale and malformed entries", () => {
  const now = 1_800_000_000_000;
  const saved = JSON.stringify([
    { id: "steam:620", started: now - 1000 },
    { id: "steam:620", started: now - 1000 },
    { id: "epic:game-1", started: now - 8 * 24 * 60 * 60 * 1000 },
    { id: "gog:1234", started: now + 1000 },
    { id: "custom:1234", started: now - 1000 },
    { id: "steam:../../bad", started: now - 1000 },
  ]);
  assert.deepEqual(parsePendingInstalls(saved, now), [
    { id: "steam:620", started: now - 1000 },
  ]);
  assert.deepEqual(parsePendingInstalls("broken", now), []);
});
test("account games merge with local installations without duplicate cards", () => {
  const owned: Game[] = [
    { ...games[0], installed: false },
    {
      id: "steam:99",
      title: "Uninstalled",
      source: "steam",
      launch: "steam://rungameid/99",
      cover: null,
      installed: false,
    },
  ];
  const merged = mergeLibrary([games[0]], owned);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((game) => game.id === games[0].id)?.installed, true);
  assert.equal(merged.find((game) => game.id === "steam:99")?.installed, false);
  assert.deepEqual(
    filterGames(merged, defaults, "all", "", true).map((game) => game.id),
    [games[0].id],
  );
});
test("corrupt settings recover and migrate valid legacy history", () => {
  assert.deepEqual(
    parsePreferences("{broken", '{"steam:1":123,"bad":"yesterday"}'),
    { ...defaults, recent: { "steam:1": 123 } },
  );
  assert.deepEqual(parsePreferences("null", "{broken"), defaults);
});
test("invalid stored values do not leak into preferences", () => {
  assert.deepEqual(
    parsePreferences(
      '{"favorites":["steam:1",4,"steam:1"],"hidden":"x","recent":{"a":-1,"b":44},"sort":"invalid","density":"invalid","liked":["620","steam:1",5,"620"],"notInterested":"y","opinionTitles":{"620":"Portal 2","999":"Not judged","620x":5}}',
    ),
    {
      ...defaults,
      favorites: ["steam:1"],
      recent: { b: 44 },
      liked: ["620"],
      opinionTitles: { "620": "Portal 2" },
    },
  );
});
test("hidden games stay out of every tab, home and favorites included", () => {
  const p = {
    ...defaults,
    hidden: ["steam:1"],
    favorites: ["steam:1", "epic:2"],
  };
  assert.deepEqual(
    filterGames(games, p, "favorites", "").map((g) => g.id),
    ["epic:2"],
  );
  assert.equal(filterGames(games, p, "all", "", true).length, 2);
  assert.ok(!filterGames(games, p, "all", "").some((g) => g.id === "steam:1"));
});
test("source and case insensitive search combine with alphabetical order", () => {
  assert.deepEqual(
    filterGames(games, defaults, "epic", " HADES ").map((g) => g.id),
    ["epic:2"],
  );
  assert.equal(filterGames(games, defaults, "steam", "hades").length, 0);
});
test("home follows play history even when library is sorted by name, without mutating input", () => {
  const p = {
    ...defaults,
    sort: "title" as const,
    recent: { "steam:1": 100, "epic:2": 200 },
  };
  assert.deepEqual(
    filterGames(games, p, "all", "").map((g) => g.title),
    ["Cyberpunk", "Hades", "Portal"],
  );
  assert.deepEqual(
    filterGames(games, p, "all", "", true).map((g) => g.title),
    ["Hades", "Portal", "Cyberpunk"],
  );
  assert.equal(games[0].title, "Portal");
});
test("favorites, source and recent history filters combine", () => {
  const now = Date.UTC(2026, 9, 13),
    day = 86400000;
  const p = {
    ...defaults,
    favorites: ["steam:1", "epic:2"],
    recent: { "steam:1": now - 2 * day, "epic:2": now - 20 * day },
    filters: {
      ...defaults.filters,
      favoritesOnly: true,
      played: "recent7" as const,
    },
  };
  assert.deepEqual(
    filterGames(games, p, "steam", "", false, now).map((g) => g.id),
    ["steam:1"],
  );
  assert.equal(filterGames(games, p, "epic", "", false, now).length, 0);
  assert.equal(filterGames(games, p, "all", "", true, now).length, 3);
});
test("never played and artwork filters do not fabricate metadata", () => {
  const withArt = [
    { ...games[0], cover: "https://example.com/cover.jpg" },
    games[1],
  ];
  const p = {
    ...defaults,
    recent: { "steam:1": 10 },
    filters: {
      ...defaults.filters,
      played: "never" as const,
      artwork: "without" as const,
    },
  };
  assert.deepEqual(
    filterGames(withArt, p, "all", "").map((g) => g.id),
    ["epic:2"],
  );
});
test("search ignores accents, sorts use launcher data, invalid filters recover", () => {
  assert.equal(
    filterGames(
      [{ ...games[0], title: "Café Simulator" }],
      defaults,
      "all",
      "cafe",
    ).length,
    1,
  );
  const played = [
    { ...games[0], title: "Portal", playtime: 30, size: 8e9, last_played: 100 },
    { ...games[1], title: "Hades", playtime: 900, size: 2e9 },
    { ...games[2], title: "Cyberpunk", last_played: 200 },
  ];
  const titles = (sort: (typeof defaults)["sort"]) =>
    filterGames(played, { ...defaults, sort }, "all", "").map((g) => g.title);
  assert.deepEqual(titles("mostPlayed"), ["Hades", "Portal", "Cyberpunk"]);
  assert.deepEqual(titles("size"), ["Portal", "Hades", "Cyberpunk"]);
  // Steam's last session counts even for games never launched from Sofa.
  assert.deepEqual(titles("recent"), ["Cyberpunk", "Portal", "Hades"]);
  const mixed = [
    { ...games[0], title: "Zelda", installed: false },
    { ...games[1], title: "Alan Wake", installed: true },
    { ...games[2], title: "Braid", installed: false },
  ];
  assert.deepEqual(
    filterGames(mixed, { ...defaults, sort: "installed" }, "all", "").map(
      (g) => g.title,
    ),
    ["Alan Wake", "Braid", "Zelda"],
  );
  assert.deepEqual(
    parsePreferences(
      '{"filters":{"favoritesOnly":"true","played":"bad","artwork":"bad"}}',
    ).filters,
    defaults.filters,
  );
});

test("category options come only from owned games, including custom categories for non-Steam games", () => {
  const p = {
    ...defaults,
    categories: { "epic:2": ["Souls-like", "Action"], uninstalled: ["Random"] },
  };
  const catalog = {
    "steam:1": ["Action", "Puzzle", "Action"],
    uninstalled: ["Sports"],
  };
  assert.deepEqual(categoryOptions(games, p, catalog), [
    { key: "action", label: "Action", count: 2 },
    { key: "puzzle", label: "Puzzle", count: 1 },
    { key: "soulslike", label: "Souls-like", count: 1 },
  ]);
});
test("multiple categories match any selection and intersect search, source and favorites", () => {
  const catalog = {
    "steam:1": ["Puzzle"],
    "epic:2": ["Souls-like"],
    "gog:3": ["RPG"],
  };
  const p = {
    ...defaults,
    favorites: ["steam:1"],
    filters: { ...defaults.filters, categories: ["puzzle", "soulslike"] },
  };
  assert.deepEqual(
    filterGames(games, p, "all", "", false, Date.now(), catalog).map(
      (g) => g.id,
    ),
    ["epic:2", "steam:1"],
  );
  assert.equal(
    filterGames(games, p, "all", "cyber", false, Date.now(), catalog).length,
    0,
  );
  assert.deepEqual(
    filterGames(
      games,
      { ...p, filters: { ...p.filters, favoritesOnly: true } },
      "steam",
      "",
      false,
      Date.now(),
      catalog,
    ).map((g) => g.id),
    ["steam:1"],
  );
  assert.equal(
    filterGames(games, p, "all", "", true, Date.now(), catalog).length,
    3,
  );
  assert.equal(filterGames(games, p, "all", "").length, 0);
});
test("category preferences validate and normalize repeated and invalid labels", () => {
  assert.deepEqual(
    cleanCategories([
      null,
      " Souls-like ",
      "soulslike",
      "",
      "A".repeat(61),
      "Action",
    ]),
    ["Souls-like", "Action"],
  );
  const p = parsePreferences(
    JSON.stringify({
      categories: { "gog:3": ["RPG", false, "RPG"] },
      filters: { categories: ["Souls-like", null] },
    }),
  );
  assert.deepEqual(p.categories, { "gog:3": ["RPG"] });
  assert.deepEqual(p.filters.categories, ["soulslike"]);
});

test("title groups use the first letter and # for everything else", () => {
  assert.equal(titleGroup("Hades"), "H");
  assert.equal(titleGroup("élan"), "É");
  assert.equal(titleGroup(" hollow knight"), "H");
  assert.equal(titleGroup("1943"), "#");
  assert.equal(titleGroup("'Tis"), "#");
  assert.equal(titleGroup(""), "#");
});

test("price region is kept only when it is a known store region", () => {
  assert.equal(
    parsePreferences(JSON.stringify({ region: "br" }), null).region,
    "br",
  );
  assert.equal(
    parsePreferences(JSON.stringify({ region: "xx" }), null).region,
    undefined,
  );
  assert.equal(parsePreferences(null, null).region, undefined);
});

test("sizes and hours read the way a console shows them", () => {
  assert.equal(formatSize(1.5 * 1024 ** 3, "en"), "1.5 GB");
  assert.equal(formatSize(1.5 * 1024 ** 3, "pt-BR"), "1,5 GB");
  assert.equal(formatSize(700 * 1024 ** 2, "en"), "700 MB");
  assert.equal(hoursPlayed(3, "en"), "");
  assert.equal(hoursPlayed(90, "en"), "1.5 h");
  assert.equal(hoursPlayed(588, "pt-BR"), "9,8 h");
  assert.equal(hoursPlayed(1230, "es"), "21 h");
});

test("the game page lists only the facts it knows, in the player's language", () => {
  const now = Date.UTC(2026, 9, 17);
  const game: Game = {
    ...games[0],
    playtime: 90,
    size: 1.5 * 1024 ** 3,
    last_played: Date.UTC(2026, 9, 4, 12) / 1000,
  };
  assert.deepEqual(
    gameFacts(
      game,
      { developer: "Valve", released: 2007, metacritic: null },
      defaults,
      "pt-BR",
      undefined,
      now,
    ),
    [
      ["factDeveloper", "Valve"],
      ["factReleased", "2007"],
      ["factPlayed", "1,5 h"],
      ["factLastPlayed", "4 de out."],
      ["factSize", "1,5 GB"],
    ],
  );
  assert.deepEqual(
    gameFacts(
      { ...games[0], installed: false },
      undefined,
      defaults,
      "en",
      700 * 1024 ** 2,
      now,
    ),
    [["factDownload", "700 MB"]],
  );
});

test("a program just added comes first on Home until something is played after it", () => {
  const program: Game = {
    id: `custom:${Date.UTC(2026, 9, 17)}`,
    title: "RetroArch",
    source: "custom",
    launch: "",
    cover: null,
    installed: true,
  };
  const played: Game = {
    ...games[0],
    installed: true,
    last_played: Date.UTC(2026, 9, 10) / 1000,
  };
  const home = (recent = {}) =>
    filterGames(
      [played, program],
      { ...defaults, recent },
      "all",
      "",
      true,
    ).map((g) => g.title);
  assert.deepEqual(home(), ["RetroArch", played.title]);
  assert.deepEqual(home({ [played.id]: Date.UTC(2026, 9, 18) }), [
    played.title,
    "RetroArch",
  ]);
});

test("the store puts deals closest to the player's taste first, the rest keeps its order", () => {
  const now = Date.UTC(2026, 9, 14);
  const game = (id: string, extra: Partial<Game> = {}): Game => ({
    id,
    title: id,
    source: "steam",
    launch: "",
    installed: true,
    ...extra,
  });
  const weights = tasteWeights(
    [
      game("steam:1", { playtime: 3000 }),
      game("steam:2", { playtime: 10 }),
      game("steam:3"),
      game("epic:x", { playtime: 9000, source: "epic" }),
    ],
    { favorites: [], recent: {} },
    now,
  );
  assert.deepEqual(
    weights.map((w) => w.appId),
    ["1", "2"],
  );
  const tags = {
    "1": [
      { tagid: 100, weight: 900 },
      { tagid: 200, weight: 100 },
    ],
    "2": [{ tagid: 300, weight: 500 }],
    "10": [{ tagid: 999, weight: 1 }],
    "20": [{ tagid: 100, weight: 50 }],
    "30": [{ tagid: 300, weight: 50 }],
  };
  const deals = ["10", "30", null, "20"].map((steamAppID) => ({ steamAppID }));
  const ranked = byTaste(deals, tasteProfile(weights, tags), tags);
  assert.deepEqual(
    ranked.map((d) => d.steamAppID),
    ["20", "30", "10", null],
  );
  assert.equal(byTaste(deals, new Map(), tags), deals);
  // A liked game counts like a favorite; one the player isn't interested in pushes its kind back.
  const opinions = tasteWeights([], {
    favorites: [],
    recent: {},
    liked: ["20"],
    notInterested: ["30"],
  });
  assert.deepEqual(opinions, [
    { appId: "20", weight: 4 },
    { appId: "30", weight: -4 },
  ]);
  assert.deepEqual(
    byTaste(deals, tasteProfile(opinions, tags), tags).map((d) => d.steamAppID),
    ["20", "10", null, "30"],
  );
});
