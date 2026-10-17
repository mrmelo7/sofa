import { CaretDownIcon } from "@phosphor-icons/react";
import { type Ref, useLayoutEffect, useRef, useState } from "react";
import { navigateControls, pickerInput, useFeatureInput } from "../services";

type PickerOption<V extends string> = { value: V; label: string };

/**
 * A choice the controller can make: A opens the list, up/down move, A picks, B closes.
 * Native <select> can't open its list from a gamepad click (no user activation).
 */
export function Picker<V extends string>({
  value,
  options,
  onChange,
  label,
  ref,
}: {
  value: V;
  options: PickerOption<V>[];
  onChange: (value: V) => void;
  label: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="picker">
      <button
        ref={(element) => {
          trigger.current = element;
          if (typeof ref === "function") ref(element);
          else if (ref) ref.current = element;
        }}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {current.label}
        <CaretDownIcon aria-hidden />
      </button>
      {open && (
        <PickerList
          value={value}
          options={options}
          label={label}
          onPick={(picked) => {
            onChange(picked);
            close();
          }}
          onClose={close}
        />
      )}
    </div>
  );
}

function PickerList<V extends string>({
  value,
  options,
  label,
  onPick,
  onClose,
}: {
  value: V;
  options: PickerOption<V>[];
  label: string;
  onPick: (value: V) => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [alignEnd, setAlignEnd] = useState(false);
  const [above, setAbove] = useState(false);
  // Measured before the first paint, so a flipped list never shows in the wrong place.
  useLayoutEffect(() => {
    const list = root.current;
    list?.querySelector<HTMLElement>("[aria-selected='true']")?.focus();
    if (!list) return;
    const rect = list.getBoundingClientRect();
    const bounds = list.closest("dialog")?.getBoundingClientRect();
    // Near the right edge (the sort control, a drawer) the list hangs off screen; flip it.
    setAlignEnd(rect.right > (bounds?.right ?? window.innerWidth) - 8);
    // Near the bottom of whatever clips it (the Library's page size above the footer) it
    // opens upward, if there is room above.
    let clip = list.parentElement?.parentElement ?? null;
    while (clip && getComputedStyle(clip).overflowY === "visible")
      clip = clip.parentElement;
    const box = clip?.getBoundingClientRect();
    const bottom = Math.min(box?.bottom ?? Infinity, window.innerHeight);
    const top = Math.max(box?.top ?? 0, 0);
    const trigger = list.parentElement?.getBoundingClientRect();
    setAbove(
      rect.bottom > bottom - 8 && (trigger?.top ?? 0) - top > rect.height + 8,
    );
  }, []);
  // While open, the controller talks only to the list (App routes through pickerInput).
  useFeatureInput(pickerInput, (a) => {
    if (a === "b") onClose();
    else navigateControls(a, root.current);
  });
  return (
    <div
      ref={root}
      role="listbox"
      aria-label={label}
      className="picker-list"
      data-align={alignEnd ? "end" : undefined}
      data-side={above ? "top" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Also keeps a surrounding <dialog> from treating it as its own cancel.
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) onClose();
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="option"
          aria-selected={o.value === value}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
