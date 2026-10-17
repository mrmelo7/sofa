import { queryOptions } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MutableRefObject } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Translate } from "./i18n";
import type { Action } from "./useInput";
export type MessageKey = Parameters<Translate>[0];
/** Shows a translated status message; hooks report through it instead of owning UI. */
export type Notify = (
  message: MessageKey,
  values?: Record<string, string>,
) => void;
export const demo =
  import.meta.env?.DEV &&
  !isTauri() &&
  new URLSearchParams(location.search).has("demo");
export type InputRef = MutableRefObject<((a: Action) => void) | null>;
const reducedMotion =
  typeof window === "undefined"
    ? undefined
    : window.matchMedia("(prefers-reduced-motion: reduce)");
const subscribeMotion = (update: () => void) => {
  reducedMotion?.addEventListener("change", update);
  return () => reducedMotion?.removeEventListener("change", update);
};
/** Follow changes while Sofa is open, including stopping an already playing preview. */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeMotion,
    () => reducedMotion?.matches ?? false,
    () => false,
  );
}
/** Whether the device has a network right now; follows the browser's online/offline events. */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
/** Set while a Picker list is open; the main window routes every action to it first. */
export const pickerInput: InputRef = { current: null };
/** Text entry takes priority over every page, dialog and picker in this window. */
export const keyboardInput: InputRef = { current: null };
export function useFeatureInput(ref: InputRef, handler: (a: Action) => void) {
  useEffect(() => {
    ref.current = handler;
    return () => {
      ref.current = null;
    };
  });
}
export function navigateControls(a: Action, root: Element | null): boolean {
  if (!root) return false;
  const controls = [
    ...root.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input, select, a[href]",
    ),
  ];
  const current = document.activeElement as HTMLElement;
  if (["up", "down", "left", "right"].includes(a)) {
    const i = controls.indexOf(current);
    controls[
      (i + (["up", "left"].includes(a) ? -1 : 1) + controls.length) %
        controls.length
    ]?.focus();
    return true;
  }
  if (
    a === "a" &&
    (current instanceof HTMLButtonElement ||
      current instanceof HTMLAnchorElement ||
      (current instanceof HTMLInputElement && current.type === "checkbox"))
  ) {
    current.click();
    return true;
  }
  return false;
}
// The skip link is for keyboard users; it sits off screen until Tab focuses it.
const focusableSelector =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]:not(.skip-link), [tabindex="0"]';

/**
 * Nearest ancestor that scrolls vertically, or null when only the page would. `seen` keeps
 * the answer per ancestor for one navigation, so a big grid doesn't read every style again.
 */
function scrollParent(
  element: Element,
  seen: Map<Element, HTMLElement | null>,
): HTMLElement | null {
  const p = element.parentElement;
  if (!p) return null;
  const known = seen.get(p);
  if (known !== undefined) return known;
  const overflow = getComputedStyle(p).overflowY;
  const found =
    (overflow === "auto" || overflow === "scroll") &&
    p.scrollHeight > p.clientHeight
      ? p
      : scrollParent(p, seen);
  seen.set(p, found);
  return found;
}
/**
 * A carousel (Home's row) keeps the focused item first and glides to it, console style. Only
 * the row scrolls: scrollIntoView would also shift every clipped ancestor, the page included.
 * Returns false when the item isn't in a carousel.
 */
export function glideToStart(item: HTMLElement): boolean {
  const row = item.closest<HTMLElement>("[data-carousel]");
  if (!row) return false;
  const style = getComputedStyle(row);
  const padding = Number.parseFloat(style.scrollPaddingLeft) || 0;
  // Selecting a game widens it and narrows the previous one over a transition that has only
  // just started; aiming at today's layout overshoots and the snap pulls the row back. Aim
  // where the item rests once it ends: every game before it at the width of an idle one.
  const items = [...row.children];
  const before = items.findIndex((child) => child.contains(item));
  const idle = items.find(
    (child) =>
      !child.contains(item) &&
      child.getAttribute("aria-current") !== "true" &&
      !child
        .getAnimations()
        .some(
          (animation) =>
            animation instanceof CSSTransition &&
            animation.transitionProperty === "flex-basis",
        ),
  );
  const left = idle
    ? (Number.parseFloat(style.paddingLeft) || 0) +
      before *
        (idle.getBoundingClientRect().width +
          (Number.parseFloat(style.columnGap) || 0)) -
      padding
    : row.scrollLeft +
      item.getBoundingClientRect().left -
      row.getBoundingClientRect().left -
      padding;
  row.scrollTo({
    left,
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  });
  return true;
}
export function navigateSpatial(
  a: Action,
  root: Element | null,
  initial?: HTMLElement | null,
): boolean {
  if (!root) return false;
  const controls = [
    ...root.querySelectorAll<HTMLElement>(focusableSelector),
  ].filter(
    (element) =>
      !element.closest("[inert], [hidden]") &&
      getComputedStyle(element).visibility !== "hidden" &&
      element.getClientRects().length > 0,
  );
  const current = document.activeElement as HTMLElement;
  if (a === "a") {
    if (controls.includes(current)) {
      current.click();
      return true;
    }
    if (initial && controls.includes(initial)) {
      initial.focus();
      initial.scrollIntoView({ block: "nearest", inline: "nearest" });
      return true;
    }
    return false;
  }
  if (!["up", "down", "left", "right"].includes(a) || !controls.length)
    return false;
  if (!controls.includes(current)) {
    // Focus was lost (a control unmounted): start from the screen's primary control.
    const primary = root.querySelector<HTMLElement>("[data-initial-focus]");
    const target =
      initial && controls.includes(initial)
        ? initial
        : primary && controls.includes(primary)
          ? primary
          : controls[0];
    target.focus();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  }
  const from = current.getBoundingClientRect();
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const vertical = a === "up" || a === "down";
  // Left/right in a carousel stay in it: at either end focus stays put, as on a console. Up
  // goes where the carousel says (`data-up`), whichever game is focused.
  const carousel = current.closest<HTMLElement>("[data-carousel]");
  const up =
    a === "up" && carousel?.dataset.up
      ? root.querySelector<HTMLElement>(carousel.dataset.up)
      : null;
  if (up && controls.includes(up)) {
    up.focus();
    up.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  }
  const pool =
    carousel && !vertical
      ? controls.filter((c) => carousel.contains(c))
      : controls;
  const direction = a === "up" || a === "left" ? -1 : 1;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  const seen = new Map<Element, HTMLElement | null>();
  const scroller = scrollParent(current, seen);
  for (const candidate of pool) {
    if (candidate === current) continue;
    const rect = candidate.getBoundingClientRect();
    // Entering another scroll container: only what it currently shows counts. A tile that
    // scrolled out above the grid sits geometrically above the tabs, but isn't a neighbour.
    const container = scrollParent(candidate, seen);
    if (container !== scroller && container) {
      const box = container.getBoundingClientRect();
      if (rect.bottom <= box.top || rect.top >= box.bottom) continue;
    }
    // Inside a scrolled grid the previous row sits past its edge, farther than the tabs
    // above it: the same container always wins while it still has something that way.
    const outside = scroller && container !== scroller ? 1e6 : 0;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const primary = (vertical ? y - cy : x - cx) * direction;
    if (primary <= 1) continue;
    const secondary = Math.abs(vertical ? x - cx : y - cy);
    const overlap = vertical
      ? Math.min(from.right, rect.right) > Math.max(from.left, rect.left)
      : Math.min(from.bottom, rect.bottom) > Math.max(from.top, rect.top);
    // Something in the same row (or column) always beats a closer one off it: wide controls
    // like the HUD's profile pills otherwise lose to the tile diagonally below.
    const aligned = overlap ? 0 : 1e5;
    const score =
      primary + secondary * (overlap ? 0.35 : 2.5) + aligned + outside;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best) {
    // Coming into a carousel from outside lands on its selected item, where the player left.
    const entered = best.closest("[data-carousel]");
    if (entered && !entered.contains(current))
      best =
        entered.querySelector<HTMLElement>('[aria-current="true"]') ?? best;
    // A carousel glides on its own; the browser's focus scroll would jump there first.
    best.focus({ preventScroll: !!best.closest("[data-carousel]") });
    if (!glideToStart(best))
      best.scrollIntoView({ block: "nearest", inline: "nearest" });
    // The first control of a scrolling panel brings back what sits above it (the title).
    const box = scrollParent(best, seen);
    if (box?.querySelector(focusableSelector) === best)
      box.scrollTo({ top: 0 });
  }
  return true;
}
const serviceErrors: MessageKey[] = [
  "network",
  "rateLimit",
  "authFailed",
  "accessDenied",
  "serviceUnavailable",
  "invalidResponse",
  "invalidInput",
  "notConnected",
  "openFailed",
  "hudOpenFailed",
  "desktopRequired",
  "batteryUnavailable",
  "powerFailed",
  "powerUnavailable",
  "powerControlUnavailable",
  "hibernateUnavailable",
  "confirmationRequired",
  "installUnavailable",
  "steamLoginCancelled",
  "steamSessionExpired",
  "epicLoginCancelled",
  "epicSessionExpired",
  "settingUnavailable",
  "bluetoothPairFailed",
  "bluetoothUnpairFailed",
  "controllerDisconnected",
  "restartRequired",
  "noGameRunning",
  "closeGameFailed",
];
/** Message key for a backend error; anything else (URLs, OS text) becomes serviceUnavailable. */
export const serviceError = (
  error: unknown,
  known: MessageKey[] = [],
): MessageKey => {
  const key = String(error) as MessageKey;
  return serviceErrors.includes(key) || known.includes(key)
    ? key
    : "serviceUnavailable";
};
/** Query for a backend command, cached under the command and its arguments. */
export const commandQuery = <T>(
  command: string,
  args?: Record<string, unknown>,
) =>
  queryOptions({
    queryKey: [command, args ?? null],
    queryFn: () => desktop<T>(command, args),
  });
/** HTTP status carried by a backend error ("http:302"), for messages that name it. */
export const httpStatus = (error: unknown) =>
  /^http:(\d+)$/.exec(String(error))?.[1];
/** Message key for a failed query, or "" while it hasn't failed. */
export const queryError = (error: unknown): MessageKey | "" =>
  error ? serviceError(error) : "";
/** The Game Bar widget loads the HUD from Sofa's local server, which exposes HUD commands over HTTP. */
const servedBySofa = () =>
  typeof location !== "undefined" &&
  location.hostname === "127.0.0.1" &&
  location.port === "47811";
type VirtualKeyboard = { show(): void };
/**
 * Spread on text fields. Moving focus onto a field with the controller must not pop the
 * keyboard. A opens Sofa's controller keyboard; a tap opens the system touch keyboard.
 */
export const keyboardOnActivate = {
  virtualkeyboardpolicy: "manual",
  onClick: (event: { currentTarget: HTMLInputElement; detail: number }) => {
    if (
      event.detail === 0 &&
      document.documentElement.classList.contains("gamepad-input")
    )
      window.dispatchEvent(
        new CustomEvent("sofa-text-entry", { detail: event.currentTarget }),
      );
    else
      (
        navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }
      ).virtualKeyboard?.show();
  },
};
export async function desktop<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isTauri()) return invoke<T>(command, args);
  if (!servedBySofa()) throw "desktopRequired";
  const response = await fetch(`/api/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  const body = await response.json();
  if (!response.ok) throw body.error ?? "serviceUnavailable";
  return body as T;
}
export type Deal = {
  gameID: string;
  dealID: string;
  storeID: string;
  title: string;
  salePrice: string;
  normalPrice: string;
  savings: string;
  thumb: string;
  steamAppID: string | null;
};
export type Shop = { storeID: string; storeName: string; isActive: number };
export type StoreGame = {
  info: { title: string; thumb: string; steamAppID: string | null };
  cheapestPriceEver: { price: string; date: number };
  deals: {
    storeID: string;
    dealID: string;
    price: string;
    retailPrice: string;
    savings: string;
  }[];
};
export function parseWishlist(raw: string | null): Deal[] {
  try {
    const list: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    return list.filter((item): item is Deal => {
      if (!item || typeof item !== "object") return false;
      const d = item as Deal;
      if (
        ![
          d.gameID,
          d.dealID,
          d.storeID,
          d.title,
          d.salePrice,
          d.normalPrice,
          d.savings,
          d.thumb,
        ].every((v) => typeof v === "string") ||
        !/^\d{1,16}$/.test(d.gameID) ||
        seen.has(d.gameID) ||
        (d.steamAppID !== null && typeof d.steamAppID !== "string")
      )
        return false;
      seen.add(d.gameID);
      return true;
    });
  } catch {
    return [];
  }
}
/** Minor units in a currency, in the interface language's format. */
export function money(minor: number, currency: string, lang: string) {
  return new Intl.NumberFormat(lang, { style: "currency", currency }).format(
    minor / 100,
  );
}
export function usd(value: string, lang: string) {
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat(lang, {
        style: "currency",
        currency: "USD",
      }).format(n)
    : "—";
}
export const demoDeals: Deal[] = [
  {
    gameID: "1",
    dealID: "demo",
    storeID: "1",
    title: "Cyberpunk 2077",
    salePrice: "20.99",
    normalPrice: "59.99",
    savings: "65",
    steamAppID: "1091500",
    thumb:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/header.jpg",
  },
  {
    gameID: "2",
    dealID: "demo",
    storeID: "7",
    title: "ELDEN RING",
    salePrice: "35.99",
    normalPrice: "59.99",
    savings: "40",
    steamAppID: "1245620",
    thumb:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/header.jpg",
  },
  {
    gameID: "3",
    dealID: "demo",
    storeID: "1",
    title: "Hades",
    salePrice: "8.49",
    normalPrice: "24.99",
    savings: "66",
    steamAppID: "1145360",
    thumb:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/header.jpg",
  },
  {
    gameID: "4",
    dealID: "demo",
    storeID: "1",
    title: "Baldur's Gate 3",
    salePrice: "44.99",
    normalPrice: "59.99",
    savings: "25",
    steamAppID: "1086940",
    thumb:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1086940/header.jpg",
  },
];
export const dealArt = (
  d: { steamAppID: string | null; thumb: string },
  wide = false,
) =>
  d.steamAppID && /^\d+$/.test(d.steamAppID)
    ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${d.steamAppID}/${wide ? "library_hero" : "library_600x900"}.jpg`
    : d.thumb;
