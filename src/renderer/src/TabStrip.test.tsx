// @vitest-environment jsdom
//
// jsdom does no layout, so nothing here can assert a rendered width. What it can
// assert is the two things that decide where the button ends up and whether the
// close target stays put: DOM order, and the inline sizing the strip writes.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TabStrip from "./TabStrip.js";
import { newTab } from "../../shared/tabs.js";
import type { Tab } from "../../shared/tabs.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const tabs = (n: number): Tab[] =>
  Array.from({ length: n }, (_, i) => ({ ...newTab(`https://shop.test/${i}`), title: `Page ${i}` }));

interface Handlers { onSelect?: (id: string) => void; onClose?: (id: string) => void; onNew?: () => void }

function render(list: Tab[], h: Handlers = {}): void {
  act(() => {
    root.render(
      <TabStrip
        tabs={list}
        activeId={list[0]?.id ?? ""}
        onSelect={h.onSelect ?? (() => {})}
        onClose={h.onClose ?? (() => {})}
        onNew={h.onNew ?? (() => {})}
      />,
    );
  });
}

/** The scrolling row that holds the chips and the button. */
const row = (): HTMLElement => {
  const el = host.querySelector("[data-tab]")?.parentElement;
  if (!el) throw new Error("no tab row rendered");
  return el;
};

const chips = (): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>("[data-tab]"));

const newButton = (): HTMLElement => {
  const el = host.querySelector<HTMLElement>('button[title^="New tab"]');
  if (!el) throw new Error("no new-tab button rendered");
  return el;
};

describe("where the new-tab button sits", () => {
  it("follows the last tab rather than the right edge of the window", () => {
    render(tabs(3));
    // Chrome's placement is a DOM-order fact, not a styling one: the button is
    // the row's last child, so it lands wherever the tabs happen to end.
    expect(row().lastElementChild).toBe(newButton());
    expect(newButton().previousElementSibling).toBe(chips()[2]);
  });

  it("moves as tabs are opened and closed", () => {
    const list = tabs(2);
    render(list);
    expect(newButton().previousElementSibling).toBe(chips()[1]);

    render(list.slice(0, 1));
    expect(newButton().previousElementSibling).toBe(chips()[0]);
  });

  it("shares the strip with the tabs, so it cannot be scrolled out of reach", () => {
    render(tabs(4));
    // A fixed-width tab scrolls the row and takes the button with it. These
    // shrink instead: grow to the cap, share down to the floor.
    for (const c of chips()) {
      expect(c.style.flex).toBe("1 1 190px");
      expect(c.style.minWidth).toBe("76px");
      expect(c.style.maxWidth).toBe("190px");
    }
  });
});

describe("closing a run of tabs", () => {
  /** jsdom lays nothing out, so stand in for the measurement the strip takes. */
  const widthIs = (px: number): void => {
    for (const c of chips()) {
      c.getBoundingClientRect = () => ({ width: px, height: 26 }) as DOMRect;
    }
  };

  const clickClose = (chip: HTMLElement): void => {
    const btn = chip.querySelector<HTMLElement>('button[title="Close tab"]');
    if (!btn) throw new Error("no close button on chip");
    act(() => { btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  };

  it("freezes tab widths so the next × lands under the cursor", () => {
    const list = tabs(4);
    const onClose = vi.fn();
    render(list, { onClose });
    widthIs(120);

    clickClose(chips()[1]);
    expect(onClose).toHaveBeenCalledWith(list[1].id);

    render(list.filter((t) => t.id !== list[1].id), { onClose });
    // Held at the width they had, rather than re-flowing wider across the gap
    // the closed tab left behind.
    for (const c of chips()) expect(c.style.flex).toBe("0 0 120px");
  });

  /** React synthesizes onMouseLeave from a bubbling `mouseout` whose
   *  relatedTarget is outside the element — a raw `mouseleave` never reaches it. */
  const pointerLeaves = (): void => {
    act(() => {
      row().dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    });
  };

  it("releases the freeze when the pointer leaves the strip", () => {
    const list = tabs(4);
    render(list);
    widthIs(120);
    clickClose(chips()[1]);
    render(list.filter((t) => t.id !== list[1].id));
    expect(chips()[0].style.flex).toBe("0 0 120px");

    pointerLeaves();
    for (const c of chips()) expect(c.style.flex).toBe("1 1 190px");
  });

  it("pins the frozen width against min-width:auto, which would overrule it", () => {
    // A flex item floors at its own min-content width unless told otherwise, and
    // a frozen tab is narrower than that by definition — the freeze only does
    // anything once tabs have shrunk. Leaving min-width off the frozen branch
    // let the floor win, so closing a tab *widened* the strip and threw the next
    // × ~130px clear of the cursor, with the flex-basis still reading correctly.
    const list = tabs(4);
    render(list);
    widthIs(120);
    clickClose(chips()[1]);
    render(list.filter((t) => t.id !== list[1].id));

    for (const c of chips()) {
      expect(c.style.flex).toBe("0 0 120px");
      expect(c.style.minWidth).toBe("0");   // React writes a bare 0, not "0px"
    }
  });

  it("releases it when a tab is opened, which nobody is aiming at", () => {
    const list = tabs(4);
    render(list);
    widthIs(120);
    clickClose(chips()[1]);
    render(list.filter((t) => t.id !== list[1].id));
    expect(chips()[0].style.flex).toBe("0 0 120px");

    render([...list, newTab("https://shop.test/new")]);
    for (const c of chips()) expect(c.style.flex).toBe("1 1 190px");
  });

  it("holds all the way down to the last tab, rather than half-releasing", () => {
    let list = tabs(4);
    render(list);
    widthIs(120);
    // Close right down to one. The freeze is a property of the strip, not of how
    // many tabs happen to be left — releasing partway would spring the strip
    // wide mid-run, which is the exact jump the freeze exists to prevent.
    while (list.length > 1) {
      clickClose(chips()[list.length - 1]);
      list = list.slice(0, -1);
      render(list);
      widthIs(120);
    }
    expect(chips()[0].style.flex).toBe("0 0 120px");
  });

  it("closes without also selecting the tab being closed", () => {
    const list = tabs(3);
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(list, { onSelect, onClose });
    clickClose(chips()[2]);
    expect(onClose).toHaveBeenCalledWith(list[2].id);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
