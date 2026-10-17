import { useEffect, useMemo, useRef } from "react";
import { useReducedMotion } from "../services";
import { playSound } from "../sounds";
import { SofaLoadingIcon } from "./SofaLoadingIcon";

/** The sofa draws itself, settles and lights its buttons in about this long (App.css). */
const PLAY = 1600;
/** When the cushions settle: the thump lands with them. */
const SETTLE = 880;
/** Covers of the last session's recent games, saved by App for the next opening. */
export const BOOT_COVERS = "boot-covers";
const covers = (): string[] => {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(BOOT_COVERS) ?? "[]",
    );
    return Array.isArray(saved)
      ? saved
          .filter(
            (url): url is string =>
              typeof url === "string" && url.startsWith("https://"),
          )
          .slice(0, 18)
      : [];
  } catch {
    return [];
  }
};

/**
 * Sofa switching on, once per launch: the sofa draws itself, settles into its cushions with a
 * low thump and lights its controller buttons, then flies to the logo in the header while Home
 * appears behind it. Behind the sofa, the player's shelf: covers of their recent games drift
 * slowly, blurred and dimmed. It only fills time Sofa spends starting anyway; any button, key or
 * touch skips it. With reduced motion the logo just shows and fades.
 */
export function BootScreen({
  skip,
  onDone,
}: {
  skip: boolean;
  onDone: () => void;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  // Three rows of the shelf; too few covers and the plain dark backdrop looks better.
  const shelf = useMemo(() => {
    const list = covers();
    if (list.length < 6) return [];
    return [0, 1, 2].map((row) =>
      Array.from({ length: 7 }, (_, i) => list[(row * 5 + i) % list.length]),
    );
  }, []);
  const leaving = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;
  const leave = useRef(() => {});
  leave.current = () => {
    if (leaving.current) return;
    leaving.current = true;
    const icon = mark.current;
    const fade = backdrop.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: reduced ? 200 : 450,
      easing: "ease-out",
      fill: "forwards",
    });
    const logo = document
      .querySelector(".brand .sofa-icon")
      ?.getBoundingClientRect();
    if (icon && logo && !reduced) {
      // A shared-element flight: the big sofa becomes the header's logo.
      const from = icon.getBoundingClientRect();
      const to = `translate(${logo.left + logo.width / 2 - (from.left + from.width / 2)}px, ${
        logo.top + logo.height / 2 - (from.top + from.height / 2)
      }px) scale(${logo.width / from.width})`;
      icon.animate(
        [
          { transform: "none", opacity: 1 },
          { transform: to, opacity: 1, offset: 0.85 },
          { transform: to, opacity: 0 },
        ],
        {
          duration: 450,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          fill: "forwards",
        },
      );
    } else icon?.animate([{ opacity: 1 }, { opacity: 0 }], 200);
    const finish = () => done.current();
    if (fade) fade.finished.then(finish, finish);
    else finish();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: the opening plays once, as it started.
  useEffect(() => {
    const thump = reduced
      ? undefined
      : setTimeout(() => playSound("boot"), SETTLE);
    const timer = setTimeout(() => leave.current(), reduced ? 500 : PLAY);
    return () => {
      clearTimeout(thump);
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (skip) leave.current();
  }, [skip]);
  return (
    <div
      className="boot-screen"
      aria-hidden
      onPointerDown={() => leave.current()}
    >
      <div className="boot-backdrop" ref={backdrop}>
        {shelf.length > 0 && (
          <div className="boot-shelf">
            {shelf.map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows that never reorder.
              <div className="boot-shelf-row" key={r}>
                {row.map((url, i) => (
                  <img
                    // biome-ignore lint/suspicious/noArrayIndexKey: a row repeats covers on purpose.
                    key={i}
                    src={url}
                    alt=""
                    decoding="async"
                    onLoad={(event) => {
                      event.currentTarget.dataset.loaded = "true";
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <span className="boot-mark" ref={mark}>
        <SofaLoadingIcon size={132} />
      </span>
    </div>
  );
}
