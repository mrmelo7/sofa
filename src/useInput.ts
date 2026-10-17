import { useEffect, useRef } from "react";
import { desktop, keyboardInput } from "./services";
export type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "a"
  | "b"
  | "x"
  | "y"
  | "lb"
  | "rb"
  | "lt"
  | "rt"
  | "home"
  | "settings"
  | "menu"
  | "power"
  | "filters";
const keys: Record<string, Action> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "a",
  Escape: "b",
  x: "x",
  u: "y",
  q: "lb",
  e: "rb",
  PageUp: "lt",
  PageDown: "rt",
  Home: "home",
  F2: "settings",
  F4: "power",
  f: "filters",
  m: "menu",
};
/**
 * Windows' gamepad keys (VK_GAMEPAD_*). Inside the Game Bar widget the WebView itself can
 * receive the controller this way, with no `key` name, and the host's bridge never sees it.
 */
const gamepadKeys: Record<number, Action> = {
  195: "a",
  196: "b",
  203: "up",
  204: "down",
  205: "left",
  206: "right",
  211: "up",
  212: "down",
  213: "right",
  214: "left",
};
const directions: Action[] = ["up", "down", "left", "right"];
const buttons: [number, Action][] = [
  [0, "a"],
  [1, "b"],
  [2, "x"],
  [3, "y"],
  [4, "lb"],
  [5, "rb"],
  [6, "lt"],
  [7, "rt"],
  [9, "settings"],
  [8, "menu"],
  [12, "up"],
  [13, "down"],
  [14, "left"],
  [15, "right"],
];
export function useInput(
  onAction: (action: Action) => void,
  nativeGamepad = false,
) {
  const cb = useRef(onAction);
  cb.current = onAction;
  useEffect(() => {
    const dispatch = (action: Action) =>
      (keyboardInput.current ?? cb.current)(action);
    const fire = (a: Action) => {
      document.documentElement.classList.add("gamepad-input");
      dispatch(a);
    };
    // The widget tells sofa.log once that it loaded and which way controller input arrives,
    // so a device report shows where navigation stops.
    const reported = new Set<string>();
    const report = (path: "ready" | "bridge" | "keys") => {
      if (!nativeGamepad || reported.has(path)) return;
      reported.add(path);
      void desktop("hud_input", { path }).catch(() => undefined);
    };
    report("ready");
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const pad = nativeGamepad ? gamepadKeys[e.keyCode] : undefined;
      if (pad) {
        e.preventDefault();
        if (!e.repeat || directions.includes(pad)) {
          report("keys");
          fire(pad);
        }
        return;
      }
      const target = e.target;
      const editing =
        target instanceof HTMLElement &&
        (target.matches("input, select, textarea") || target.isContentEditable);
      if (editing && e.key !== "Escape") return;
      // Native controls handle Enter/Space themselves; avoid firing twice.
      if (target instanceof HTMLButtonElement && e.key === "Enter") return;
      const a = keys[e.key];
      if (a && (!e.repeat || ["up", "down", "left", "right"].includes(a))) {
        document.documentElement.classList.remove("gamepad-input");
        e.preventDefault();
        dispatch(a);
      }
    };
    window.addEventListener("keydown", onKey);
    // When each held action fired last, and when its press began (for the repeat delay).
    const last = new Map<Action, number>();
    const since = new Map<Action, number>();
    // The UWP host forwards routed gamepad keys; polling the same controller
    // here would execute every action twice and depends on WebView gamepad focus.
    const onNativeGamepad = (event: Event) => {
      const action = (event as CustomEvent<unknown>).detail;
      if (
        ["up", "down", "left", "right", "a", "b"].includes(action as string)
      ) {
        report("bridge");
        fire(action as Action);
      }
    };
    if (nativeGamepad) window.addEventListener("sofa-gamepad", onNativeGamepad);
    let raf = 0;
    const poll = () => {
      if (!document.hasFocus()) {
        last.clear();
        since.clear();
        raf = requestAnimationFrame(poll);
        return;
      }
      const now = performance.now(),
        held = new Set<Action>();
      for (const pad of navigator.getGamepads?.() ?? []) {
        if (pad?.mapping !== "standard") continue;
        for (const [i, a] of buttons) if (pad.buttons[i]?.pressed) held.add(a);
        // One direction per tick: a diagonal push follows its stronger axis.
        const [x = 0, y = 0] = pad.axes;
        if (Math.abs(y) >= Math.abs(x)) {
          if (y < -0.5) held.add("up");
          if (y > 0.5) held.add("down");
        } else {
          if (x < -0.5) held.add("left");
          if (x > 0.5) held.add("right");
        }
      }
      for (const a of last.keys())
        if (!held.has(a)) {
          last.delete(a);
          since.delete(a);
        }
      for (const a of held) {
        // Directions repeat like a console: a pause after the press, then a steady pace.
        const repeats = ["up", "down", "left", "right"].includes(a);
        if (
          !last.has(a) ||
          (repeats &&
            now - (since.get(a) ?? now) > 350 &&
            now - (last.get(a) ?? 0) > 120)
        ) {
          if (!last.has(a)) since.set(a, now);
          last.set(a, now);
          fire(a);
        }
      }
      raf = requestAnimationFrame(poll);
    };
    if (!nativeGamepad) raf = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      window.removeEventListener("sofa-gamepad", onNativeGamepad);
    };
  }, [nativeGamepad]);
}
