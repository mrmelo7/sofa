import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Translate } from "../i18n";
import { type Game, hero, launcherName } from "../library";
import { SofaLoadingIcon } from "./SofaLoadingIcon";

/**
 * Shown while a launcher starts the game: the game's art behind the animated Sofa, a line
 * saying what is happening, and a way back. Dismissed by App when the game takes focus,
 * after a timeout, or with A/B.
 */
export function LaunchScreen({
  game,
  preparing,
  t,
  onBack,
}: {
  game: Game;
  /** The launcher showed up (Rust's `launch-progress`). */
  preparing: boolean;
  t: Translate;
  onBack: () => void;
}) {
  const art = hero(game);
  const launcher = launcherName(game.source);
  // A launcher updating itself or syncing saves can take a while; say so instead of
  // looking stuck.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 15_000);
    return () => clearTimeout(id);
  }, []);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus({ preventScroll: true }), []);
  return (
    <div className="launch-screen">
      {art && (
        <div
          className="launch-art"
          style={{ backgroundImage: `url("${art}")` }}
        />
      )}
      <div className="launch-content">
        <span className="launch-icon">
          <SofaLoadingIcon size={96} />
        </span>
        <h2>{game.title}</h2>
        <p role="status">
          {!launcher
            ? t("launchingGame")
            : t(preparing ? "launchPreparing" : "launchStarting", {
                launcher,
              })}
        </p>
        {slow && <p className="launch-note">{t("launchSlow")}</p>}
        <button ref={back} onClick={onBack}>
          <ArrowLeftIcon />
          {t("launchBack")}
        </button>
      </div>
    </div>
  );
}
