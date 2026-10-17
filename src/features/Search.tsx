import {
  ArrowRightIcon,
  type Icon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { CoverImage } from "../components/Cover";
import { Dialog } from "../components/Dialog";
import { Loading } from "../components/Loading";
import { SearchField } from "../components/SearchField";
import type { Lang, Translate } from "../i18n";
import {
  defaultFilters,
  filterGames,
  fold,
  type Game,
  type Preferences,
} from "../library";
import { type InputRef, navigateSpatial, useFeatureInput } from "../services";

/** A Settings card the search can open, matched on its name and description. */
export type SettingsShortcut = {
  id: string;
  Icon: Icon;
  label: string;
  description: string;
  external?: boolean;
  open: () => void;
};

/**
 * Search the whole library, and Settings like Spotlight, without changing the page or its
 * filters behind the dialog.
 */
export function Search({
  games,
  settings,
  onSetting,
  prefs,
  initialQuery,
  loading,
  t,
  lang,
  input,
  onOpen,
  onBrowse,
  onClose,
  origin,
}: {
  games: Game[];
  settings: SettingsShortcut[];
  onSetting: (shortcut: SettingsShortcut) => void;
  prefs: Preferences;
  initialQuery: string;
  loading: boolean;
  t: Translate;
  lang: Lang;
  input: InputRef;
  onOpen: (game: Game) => void;
  onBrowse: (query: string) => void;
  onClose: () => void;
  origin: DOMRect | undefined;
}) {
  const [query, setQuery] = useState(initialQuery);
  const deferred = useDeferredValue(query);
  const root = useRef<HTMLDivElement>(null);
  const close = () =>
    root.current
      ?.closest("dialog")
      ?.dispatchEvent(new Event("cancel", { cancelable: true }));
  const results = useMemo(
    () =>
      filterGames(
        games,
        { ...prefs, filters: defaultFilters, sort: "recent" },
        "all",
        deferred,
      ),
    [games, prefs, deferred],
  );
  const q = fold(deferred.trim());
  const settingResults = q
    ? settings
        .filter((s) => fold(`${s.label} ${s.description}`).includes(q))
        .slice(0, 3)
    : [];
  useFeatureInput(input, (action) => {
    if (action === "b") close();
    else navigateSpatial(action, root.current?.closest("dialog") ?? null);
  });
  return (
    <Dialog label={t("search")} onClose={onClose} origin={origin}>
      <div className="spotlight" ref={root}>
        <div className="spotlight-search">
          <MagnifyingGlassIcon aria-hidden />
          <SearchField
            value={query}
            name="game-search"
            data-initial-focus
            placeholder={`${t("searchHint")}…`}
            aria-label={t("search")}
            enterKeyHint="search"
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            clearLabel={t("clearSearch")}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                root.current
                  ?.querySelector<HTMLButtonElement>(".spotlight-result")
                  ?.focus();
              } else if (event.key === "Enter" && results[0]) {
                event.preventDefault();
                onOpen(results[0]);
              } else if (event.key === "Enter" && settingResults[0]) {
                event.preventDefault();
                onSetting(settingResults[0]);
              }
            }}
          />
          <button
            className="spotlight-close"
            onClick={close}
            aria-label={t("close")}
          >
            <XIcon />
          </button>
        </div>
        {loading && games.length === 0 ? (
          <div className="spotlight-empty">
            <Loading label={t("scanning")} />
          </div>
        ) : (
          <>
            {/* Only Settings matched: their heading alone, no "0 results" above it. */}
            {(results.length > 0 || settingResults.length === 0) && (
              <h2 className="spotlight-heading" role="status">
                {query.trim()
                  ? t("searchResults", {
                      count: new Intl.NumberFormat(lang).format(results.length),
                    })
                  : t("library")}
              </h2>
            )}
            {results.length > 0 ? (
              <div className="spotlight-results">
                {results.slice(0, 6).map((game) => (
                  <button
                    className="spotlight-result"
                    data-game-id={game.id}
                    key={game.id}
                    onClick={() => onOpen(game)}
                  >
                    <span className="spotlight-cover">
                      <CoverImage game={game} />
                    </span>
                    <span className="spotlight-game">
                      <strong>{game.title}</strong>
                      <span>
                        {game.source === "custom"
                          ? t("customGames")
                          : game.source === "xbox"
                            ? "Xbox"
                            : game.source.toUpperCase()}{" "}
                        ·{" "}
                        {t(game.installed ? "installed" : "availableToInstall")}
                      </span>
                    </span>
                    <ArrowRightIcon aria-hidden />
                  </button>
                ))}
              </div>
            ) : (
              settingResults.length === 0 && (
                <p className="spotlight-empty">
                  {t(query.trim() ? "noMatches" : "noGames")}
                </p>
              )
            )}
            {settingResults.length > 0 && (
              <>
                <h2 className="spotlight-heading">{t("settings")}</h2>
                <div className="spotlight-results">
                  {settingResults.map((shortcut) => (
                    <button
                      className="spotlight-result"
                      key={shortcut.id}
                      onClick={() => onSetting(shortcut)}
                    >
                      <span className="spotlight-cover spotlight-icon">
                        <shortcut.Icon aria-hidden />
                      </span>
                      <span className="spotlight-game">
                        <strong>{shortcut.label}</strong>
                        <span>{shortcut.description}</span>
                      </span>
                      <ArrowRightIcon aria-hidden />
                    </button>
                  ))}
                </div>
              </>
            )}
            {results.length > 0 && (
              <button
                className="spotlight-browse"
                onClick={() => onBrowse(query)}
              >
                {t("browseLibrary")}
                <ArrowRightIcon />
              </button>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
