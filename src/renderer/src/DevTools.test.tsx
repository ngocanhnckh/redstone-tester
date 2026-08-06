// @vitest-environment jsdom
//
// The inspector's frontend is a native view outside the DOM, so nothing here
// can assert on what it renders. What CAN break silently is the bookkeeping
// this component owns, and that is what is pinned:
//
//  - it must not attach until the guest actually has a webContents id;
//  - it must report the slot's rect, since a native view cannot be laid out;
//  - it must hide the view rather than let it sit on top of a modal;
//  - it must free the view on unmount, because nothing else will.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DevTools, { MIN_PANEL, MIN_STAGE, clampSize } from "./DevTools.js";
import type { WebviewEl } from "./env.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GUEST_ID = 7;
const SLOT = { x: 12, y: 640, width: 1400, height: 280 };

let host: HTMLDivElement;
let root: Root;
let attach: ReturnType<typeof vi.fn>;
let bounds: ReturnType<typeof vi.fn>;
let detach: ReturnType<typeof vi.fn>;
const realRect = Element.prototype.getBoundingClientRect;

const noop = (): void => {};

beforeEach(() => {
  vi.useFakeTimers();
  attach = vi.fn().mockResolvedValue({ ok: true, data: undefined });
  bounds = vi.fn().mockResolvedValue({ ok: true, data: undefined });
  detach = vi.fn().mockResolvedValue({ ok: true, data: undefined });
  (window as unknown as { tester: unknown }).tester = { devtools: { attach, bounds, detach } };

  // jsdom lays nothing out, so every rect is 0×0 — give the slot a real one.
  Element.prototype.getBoundingClientRect = function (): DOMRect {
    if (!(this as HTMLElement).classList.contains("dock-slot")) return new DOMRect();
    return new DOMRect(SLOT.x, SLOT.y, SLOT.width, SLOT.height);
  };

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Element.prototype.getBoundingClientRect = realRect;
  vi.useRealTimers();
});

/** A guest that is already attached, as a live tab's always is. */
function guest(): WebviewEl {
  return { getWebContentsId: () => GUEST_ID } as unknown as WebviewEl;
}

async function render(
  getGuest: () => WebviewEl | null,
  visible = true,
): Promise<void> {
  await act(async () => {
    root.render(
      <DevTools
        getGuest={getGuest} side="bottom" size={320} available={900} visible={visible}
        onSize={noop} onSide={noop} onResizing={noop} onClose={noop}
      />,
    );
  });
}

describe("the docked inspector", () => {
  it("attaches to the guest, at the slot's rect", async () => {
    await render(guest);
    expect(attach).toHaveBeenCalledWith(
      GUEST_ID,
      { x: SLOT.x, y: SLOT.y, width: SLOT.width, height: SLOT.height },
      true,
    );
  });

  it("waits for a guest that registers after the panel is already open", async () => {
    // Opening the inspector and then opening a new tab: the panel mounts before
    // that tab's <webview> exists.
    let current: WebviewEl | null = null;
    await render(() => current);

    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(attach).not.toHaveBeenCalled();

    current = guest();
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    expect(attach).toHaveBeenCalledWith(GUEST_ID, expect.anything(), true);
  });

  it("tells main to hide the view when something is drawn over it", async () => {
    await render(guest, false);
    expect(attach).toHaveBeenCalledWith(GUEST_ID, expect.anything(), false);
  });

  it("frees the native view when the panel goes away", async () => {
    await render(guest);
    await act(async () => { root.render(null); });
    expect(detach).toHaveBeenCalled();
  });

  it("frees it even when it never managed to attach — the view may still exist", async () => {
    await render(() => null);
    await act(async () => { root.render(null); });
    expect(detach).toHaveBeenCalled();
  });

  it("syncs the slot once and then goes quiet", async () => {
    // The follow loop runs every frame, so a rect that has not moved must not
    // turn into an IPC call per frame for as long as the inspector is open.
    await render(guest);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(bounds).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(bounds).toHaveBeenCalledTimes(1);
  });

  it("hides the view as soon as a modal goes up, without waiting for a move", async () => {
    await render(guest);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    bounds.mockClear();

    await render(guest, false);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(bounds).toHaveBeenLastCalledWith(expect.anything(), false);
  });

  it("does not push bounds before there is a dock to move", async () => {
    await render(() => null);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(bounds).not.toHaveBeenCalled();
  });

  it("gives up out loud rather than leaving a blank panel", async () => {
    await render(() => null);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(host.textContent).toContain("not attached");
  });
});

describe("clampSize", () => {
  it("keeps the page under test visible", () => {
    expect(clampSize(880, 900)).toBe(900 - MIN_STAGE);
  });

  it("refuses to shrink the panel to a title bar", () => {
    expect(clampSize(20, 900)).toBe(MIN_PANEL);
  });

  it("takes the size asked for when both fit", () => {
    expect(clampSize(400, 900)).toBe(400);
  });

  it("yields to the panel minimum on a window too small for both", () => {
    // Nothing can satisfy MIN_PANEL + MIN_STAGE here; the panel keeps its floor
    // rather than collapsing to nothing.
    expect(clampSize(300, 250)).toBe(MIN_PANEL);
  });
});
