import { useEffect, useRef } from "react";
import { useReducedMotion } from "../services";
import { playSound } from "../sounds";
import { SofaLoadingIcon } from "./SofaLoadingIcon";

/** The sofa draws itself, settles and lights its buttons in about this long (App.css). */
const PLAY = 1600;
/** When the cushions settle: the thump lands with them. */
const SETTLE = 880;

/**
 * Sofa switching on, once per launch: the sofa draws itself, settles into its cushions with a
 * low thump and lights its controller buttons, then flies to the logo in the header while Home
 * appears behind it. It only fills time Sofa spends starting anyway; any button, key or touch
 * skips it. With reduced motion the logo just shows and fades.
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
      <div className="boot-backdrop" ref={backdrop} />
      <span className="boot-mark" ref={mark}>
        <SofaLoadingIcon size={132} />
      </span>
    </div>
  );
}
