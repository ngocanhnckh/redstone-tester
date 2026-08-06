// The inspector, docked into the cockpit the way a browser docks its own.
//
// Electron opens a <webview>'s DevTools in a detached window and offers no
// alternative: the docked modes belong to a BrowserWindow, and a guest has no
// window of its own to dock into. `setDevToolsWebContents` is the way out — it
// renders the frontend into a WebContents we supply.
//
// That WebContents cannot be another <webview>; it has to be a native view main
// owns. See the note in main/index.ts for why, and what the convincing-looking
// failure is if you try. The consequence here is that this component draws only
// the chrome — header, splitter, and an empty SLOT. The frontend paints over
// that slot from outside the DOM entirely, so this file's real job is to keep
// main told where the slot is and whether anything is covering it.

import { useEffect, useRef, useState } from "react";
import type { JSX, PointerEvent as ReactPointerEvent } from "react";
import type { WebviewEl } from "./env.js";
import { Icon } from "./Icons.js";
import type { DockSide } from "./store.js";
import type { DockBounds } from "../../shared/types.js";

/** Below this the inspector is a title bar with a sliver under it. */
export const MIN_PANEL = 160;
/** Always leave this much of the page visible. A dock that can swallow the page
 *  under test is one you have to undock before you can use it. */
export const MIN_STAGE = 200;

/** `available` is the full length of the axis being resized — the stage plus the
 *  panel currently on it. */
export function clampSize(want: number, available: number): number {
  // On a window too small to satisfy both minimums, the panel yields: the page
  // under test is the thing being tested.
  const max = Math.max(MIN_PANEL, available - MIN_STAGE);
  return Math.min(Math.max(Math.round(want), MIN_PANEL), max);
}

interface Props {
  /** Read lazily rather than passed: the active tab's <webview> can register
   *  after this panel has mounted (open the inspector, then open a new tab) and
   *  that registration does not re-render the parent. */
  getGuest: () => WebviewEl | null;
  side: DockSide;
  size: number;
  available: number;
  /** False while anything is drawn over the dock. A native view has no z-index
   *  and would sit on top of a modal, so it is hidden outright instead. */
  visible: boolean;
  onSize: (px: number) => void;
  onSide: (side: DockSide) => void;
  /** Raised for the length of a drag, so the parent can suppress text selection
   *  and stop the guest taking the pointer as the cursor sweeps over the page. */
  onResizing: (on: boolean) => void;
  onClose: () => void;
}

export default function DevTools({
  getGuest, side, size, available, visible, onSize, onSide, onResizing, onClose,
}: Props): JSX.Element {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the live props in a ref: the drag handlers must not be rebuilt mid-drag,
  // and neither long-lived effect below may re-run when a number changes.
  const live = useRef({ side, size, available, visible, onSize, onResizing });
  live.current = { side, size, available, visible, onSize, onResizing };

  /** Set once main has a dock for us, so bounds updates aren't sent into the void. */
  const attached = useRef(false);

  const slotBox = (): DockBounds | null => {
    const el = slotRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;

    const attach = (): void => {
      if (cancelled) return;
      const guest = getGuest();
      const box = slotBox();
      let id: number | null = null;
      if (guest) {
        // getWebContentsId throws until the guest has attached and emitted
        // dom-ready, which makes it the readiness gate — no listener to miss,
        // unlike dom-ready itself, which fires once and can beat this effect.
        try { id = guest.getWebContentsId(); } catch { id = null; }
      }
      if (id === null || !box) {
        // ~6s. Say so rather than leaving an empty panel, which reads as a
        // broken inspector rather than one that never got attached.
        if (tries++ > 100) setError("The page never attached to the inspector.");
        else timer = setTimeout(attach, 60);
        return;
      }
      void window.tester.devtools.attach(id, box, live.current.visible).then((r) => {
        if (cancelled) return;
        if (r.ok) attached.current = true;
        else setError(r.error);
      });
    };
    attach();

    return () => {
      cancelled = true;
      attached.current = false;
      if (timer) clearTimeout(timer);
      // The view is native and outlives this component; nothing else will free it.
      void window.tester.devtools.detach();
    };
  }, [getGuest]);

  // Follow the slot. Polled rather than observed because the slot MOVES without
  // resizing — the queue sidebar opening, the steps panel or retest bar
  // appearing, the window being dragged to another display — and a rect diff
  // catches every cause at once. One layout read per frame, only while open.
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      if (!attached.current) return;
      const box = slotBox();
      if (!box) return;
      const vis = live.current.visible;
      const key = `${Math.round(box.x)}|${Math.round(box.y)}|${Math.round(box.width)}|${Math.round(box.height)}|${vis}`;
      if (key === last) return;
      last = key;
      void window.tester.devtools.bounds(box, vis);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── resize ────────────────────────────────────────────────────────────────
  const drag = useRef<{ from: number; size: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { from: side === "right" ? e.clientX : e.clientY, size };
    live.current.onResizing(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    const { side: s, available: avail, onSize: set } = live.current;
    // The panel is on the far side of the splitter, so it grows as the pointer
    // moves *away* from it — hence the subtraction.
    const delta = (s === "right" ? e.clientX : e.clientY) - d.from;
    set(clampSize(d.size - delta, avail));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    drag.current = null;
    live.current.onResizing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const vertical = side === "right";

  return (
    <div
      className={`flex min-h-0 min-w-0 ${vertical ? "flex-row" : "flex-col"}`}
      style={{ flex: "none", [vertical ? "width" : "height"]: size }}
    >
      <div
        role="separator"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-label="Resize the inspector"
        className={`splitter splitter--${vertical ? "v" : "h"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />

      <div className="glass-surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        style={{ borderRadius: 14 }}>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <span className="label !mb-0">Inspector</span>
          <span className="flex-1" />
          {error && (
            <span className="chip chip--warn" title={error}>
              <Icon name="alert" size={11} /> not attached
            </span>
          )}
          <button
            className={`btn btn--icon btn--ghost !h-6 !w-6 ${side === "bottom" ? "btn--on" : ""}`}
            onClick={() => onSide("bottom")} title="Dock to the bottom">
            <Icon name="dockBottom" size={13} />
          </button>
          <button
            className={`btn btn--icon btn--ghost !h-6 !w-6 ${side === "right" ? "btn--on" : ""}`}
            onClick={() => onSide("right")} title="Dock to the right">
            <Icon name="dockRight" size={13} />
          </button>
          <button className="btn btn--icon btn--ghost !h-6 !w-6" onClick={onClose}
            title="Close the inspector (F12)">
            <Icon name="close" size={13} />
          </button>
        </div>

        {/* The slot. Deliberately empty — the frontend paints over it from
            outside the DOM, and anything rendered here would be hidden by it. */}
        <div ref={slotRef} className="dock-slot flex-1" />
      </div>
    </div>
  );
}
