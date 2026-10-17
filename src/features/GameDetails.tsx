import {
  ArrowLeftIcon,
  DownloadSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import { FavoriteIcon } from "../components/FavoriteIcon";
import { GameBadges, type Media, SteamMedia } from "../components/SteamMedia";
import type { Lang, Translate } from "../i18n";
import { type Game, gameFacts, hero, type Preferences } from "../library";
import {
  commandQuery,
  type InputRef,
  navigateSpatial,
  useFeatureInput,
  useReducedMotion,
} from "../services";
import { Uninstall } from "./Uninstall";

export type GameOrigin = {
  trigger: HTMLElement | null;
  cover: DOMRect | undefined;
  title: DOMRect | undefined;
  action: DOMRect | undefined;
  meta: DOMRect[];
  shared: HTMLElement[];
};

/** Measure before changing the view; a keyboard or controller activation uses the same origin. */
export function captureGameOrigin(id: string): GameOrigin {
  const trigger =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const cover =
    trigger?.closest<HTMLElement>(".tile, .spotlight-result") ??
    [
      ...document.querySelectorAll<HTMLElement>(".tile, .spotlight-result"),
    ].find((el) => el.dataset.gameId === id);
  const heroSection = [
    ...document.querySelectorAll<HTMLElement>(".hero-copy"),
  ].find((el) => el.dataset.gameId === id);
  return {
    trigger,
    cover: cover?.getBoundingClientRect(),
    title: heroSection
      ?.querySelector(".hero-info:not([inert]) h1")
      ?.getBoundingClientRect(),
    action: heroSection
      ?.querySelector(".primary-action")
      ?.getBoundingClientRect(),
    meta: [
      ...(heroSection?.querySelectorAll(
        ".hero-info:not([inert]) > .game-meta, .hero-info:not([inert]) > p",
      ) ?? []),
    ].map((el) => el.getBoundingClientRect()),
    shared: [
      ...(heroSection?.querySelectorAll<HTMLElement>(
        ".hero-info:not([inert]) > *, .primary-action",
      ) ?? []),
    ],
  };
}

/** A full-screen game page; the store comparison keeps its separate modal frame. */
export function GameDetails({
  game,
  t,
  lang,
  prefs,
  sizeEstimate,
  launching,
  onPlay,
  onInstall,
  onToggleFavorite,
  onToggleHidden,
  onUninstalled,
  onClose,
  origin,
  input,
}: {
  game: Game;
  t: Translate;
  lang: Lang;
  prefs: Preferences;
  sizeEstimate: number | null | undefined;
  launching: boolean;
  onPlay: (game: Game) => void;
  onInstall: (game: Game) => void;
  onToggleFavorite: (game: Game) => void;
  onToggleHidden: (game: Game) => void;
  onUninstalled: (id: string) => void;
  onClose: () => void;
  origin: GameOrigin | null;
  input: InputRef;
}) {
  const root = useRef<HTMLElement>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const closing = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const reduced = useReducedMotion();
  const close = () => {
    if (closing.current || document.querySelector("[data-uninstall-busy]"))
      return;
    closing.current = true;
    if (reduced || !timeline.current || timeline.current.time() === 0)
      closeRef.current();
    else
      timeline.current
        .eventCallback("onReverseComplete", () => closeRef.current())
        .reverse();
  };
  useFeatureInput(input, (action) => {
    if (action === "b") close();
    else if (!closing.current)
      navigateSpatial(action, root.current?.closest("main") ?? null);
  });
  useLayoutEffect(() => {
    const view = root.current;
    if (!view) return;
    const main = view.closest("main");
    const stage = main?.querySelector(".page-stage");
    const title = view.querySelector("h1");
    const action = view.querySelector("[data-initial-focus]");
    const shell = view.querySelector(".game-morph-art");
    const context = gsap.context(() => {
      // The moving copies replace their Home counterparts for the whole round trip.
      if (origin?.shared.length)
        gsap.set(origin.shared, { visibility: "hidden" });
      const motion = gsap.timeline({
        defaults: { duration: reduced ? 0 : 0.48, ease: "power3.inOut" },
      });
      timeline.current = motion;
      if (stage)
        motion.to(
          stage,
          { opacity: 0, y: reduced ? 0 : 38, duration: reduced ? 0 : 0.22 },
          0,
        );
      const move = (element: Element | null, from: DOMRect | undefined) => {
        if (!element) return;
        const to = element.getBoundingClientRect();
        motion.fromTo(
          element,
          {
            x: reduced || !from ? 0 : from.left - to.left,
            y: reduced ? 0 : from ? from.top - to.top : 22,
            scale: reduced || !from ? 1 : from.height / to.height,
            opacity: from || reduced ? 1 : 0,
            transformOrigin: "left top",
          },
          { x: 0, y: 0, scale: 1, opacity: 1 },
          0,
        );
      };
      move(title, origin?.title);
      move(action, origin?.action);
      view.querySelectorAll(".game-view-meta").forEach((element, i) => {
        move(element, origin?.meta[i]);
      });
      motion.fromTo(
        ".game-view-actions > :not(:first-child), .game-view-panel, .game-back",
        { opacity: reduced ? 1 : 0, y: reduced ? 0 : 16 },
        {
          opacity: 1,
          y: 0,
          duration: reduced ? 0 : 0.28,
          stagger: reduced ? 0 : 0.025,
        },
        reduced ? 0 : 0.12,
      );
      if (shell && origin?.cover && !reduced) {
        const to = shell.getBoundingClientRect();
        const from = origin.cover;
        const sx = from.width / to.width;
        const sy = from.height / to.height;
        motion.fromTo(
          shell,
          {
            x: from.left - to.left,
            y: from.top - to.top,
            scaleX: sx,
            scaleY: sy,
            borderRadius: 14,
            transformOrigin: "left top",
            opacity: 1,
          },
          { x: 0, y: 0, scaleX: 1, scaleY: 1, borderRadius: 0 },
          0,
        );
        motion.fromTo(
          ".game-morph-art img",
          { scaleX: sy / sx },
          { scaleX: 1 },
          0,
        );
        motion.to(shell, { opacity: 0, duration: 0.18 }, 0.28);
      } else gsap.set(shell, { opacity: 0 });
    }, view);
    view
      .querySelector<HTMLElement>("[data-initial-focus]")
      ?.focus({ preventScroll: true });
    return () => {
      context.revert();
      timeline.current = null;
      // React has removed inert from the origin by the next frame, including after StrictMode's rehearsal.
      requestAnimationFrame(() => {
        if (view.isConnected || main?.querySelector(".game-view")) return;
        const target = origin?.trigger?.isConnected
          ? origin.trigger
          : main?.querySelector<HTMLElement>(
              ".tile[aria-current='true'], .system-bar button[aria-haspopup='dialog']",
            );
        target?.focus({ preventScroll: true });
      });
    };
  }, [origin, reduced]);
  const favorite = prefs.favorites.includes(game.id);
  const hidden = prefs.hidden.includes(game.id);
  // The facts strip, and for an uninstalled game what it is, from its Steam page.
  const media = useQuery({
    ...commandQuery<Media>("game_media", {
      id: game.id,
      title: game.title,
      lang,
    }),
    enabled: isTauri(),
    // Store pages barely change; Rust keeps them on disk for 30 days.
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <section
      ref={root}
      className="game-view"
      data-installed={game.installed}
      id="game-details"
      aria-labelledby="game-heading"
      tabIndex={-1}
    >
      <div className="game-morph-art" aria-hidden>
        {hero(game) && (
          <img
            src={hero(game)}
            alt=""
            width={1920}
            height={1080}
            onError={(event) => {
              event.currentTarget.style.visibility = "hidden";
            }}
          />
        )}
      </div>
      <button className="game-back" onClick={close}>
        <ArrowLeftIcon />
        {t("back")}
      </button>
      <div className="game-view-copy">
        <p className="detail-meta game-view-meta">
          {game.source === "custom"
            ? t("customApp")
            : game.source.toUpperCase()}{" "}
          · {t(game.installed ? "installed" : "availableToInstall")}
        </p>
        <h1 id="game-heading">{game.title}</h1>
        <dl className="game-facts game-view-meta" aria-busy={media.isLoading}>
          {/* The Steam page's facts take shape where they will land. */}
          {media.isLoading &&
            (["factDeveloper", "factReleased", "factMetacritic"] as const).map(
              (key) => (
                <div key={key} aria-hidden>
                  <dt>{t(key)}</dt>
                  <dd className="skeleton" />
                </div>
              ),
            )}
          {gameFacts(
            game,
            media.data,
            prefs,
            lang,
            sizeEstimate ?? undefined,
          ).map(([key, value]) => (
            <div key={key}>
              <dt>{t(key)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="detail-actions game-view-actions">
          <button
            data-initial-focus
            className="accent game-play"
            aria-disabled={game.installed && launching}
            aria-busy={game.installed && launching}
            onClick={() => (game.installed ? onPlay(game) : onInstall(game))}
          >
            {game.installed ? (
              <PlayIcon weight="fill" />
            ) : (
              <DownloadSimpleIcon weight="bold" />
            )}
            {t(game.installed ? "play" : "installGame")}
          </button>
          <button
            aria-pressed={favorite}
            onClick={() => onToggleFavorite(game)}
          >
            <FavoriteIcon active={favorite} />
            {t(favorite ? "removeFavorite" : "addFavorite")}
          </button>
          <button onClick={() => onToggleHidden(game)}>
            {hidden ? <EyeIcon /> : <EyeSlashIcon />}
            {t(hidden ? "restoreGame" : "hideGame")}
          </button>
          {game.installed && (
            <Uninstall game={game} t={t} onUninstalled={onUninstalled} />
          )}
        </div>
      </div>
      {!game.installed && (
        <div className="game-view-panel">
          <p className="muted">{t("installHint")}</p>
          <GameBadges media={media.data} t={t} lang={lang} />
          <SteamMedia
            key={game.id}
            media={media.data}
            loading={media.isLoading}
            t={t}
            lang={lang}
          />
        </div>
      )}
    </section>
  );
}
