import { describe, expect, it } from "vitest";
import {
  EMPTY_WORKSPACE, addBookmark, addTab, closeTab, isBookmarked, newTab, patchTab,
  removeBookmark, restore, snapshot, tabLabel,
} from "./tabs.js";
import type { TabState } from "./tabs.js";

const state = (urls: string[], activeIndex = 0): TabState => {
  const tabs = urls.map(newTab);
  return { tabs, activeId: tabs[activeIndex]?.id ?? "" };
};

describe("addTab", () => {
  it("appends and focuses the new tab", () => {
    const s = addTab(state(["https://a.test"]), "https://b.test");
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(s.tabs[1].id);
  });

  it("can open in the background", () => {
    const before = state(["https://a.test"]);
    const s = addTab(before, "https://b.test", false);
    expect(s.activeId).toBe(before.activeId);
  });
});

describe("closeTab", () => {
  it("focuses the right-hand neighbour", () => {
    const s = state(["a", "b", "c"], 1);
    const out = closeTab(s, s.tabs[1].id);
    expect(out.tabs.map((t) => t.url)).toEqual(["a", "c"]);
    expect(out.activeId).toBe(s.tabs[2].id);
  });

  it("falls back to the left when closing the last tab", () => {
    const s = state(["a", "b", "c"], 2);
    const out = closeTab(s, s.tabs[2].id);
    expect(out.activeId).toBe(s.tabs[1].id);
  });

  it("leaves focus alone when closing a background tab", () => {
    const s = state(["a", "b", "c"], 0);
    const out = closeTab(s, s.tabs[2].id);
    expect(out.activeId).toBe(s.tabs[0].id);
  });

  it("empties the strip when the only tab closes", () => {
    const s = state(["a"]);
    expect(closeTab(s, s.tabs[0].id)).toEqual({ tabs: [], activeId: "" });
  });

  it("ignores an unknown id", () => {
    const s = state(["a", "b"]);
    expect(closeTab(s, "nope")).toBe(s);
  });
});

describe("patchTab", () => {
  it("updates only the named tab", () => {
    const s = state(["a", "b"]);
    const out = patchTab(s, s.tabs[1].id, { title: "B", loading: true });
    expect(out.tabs[0].title).toBe("");
    expect(out.tabs[1]).toMatchObject({ title: "B", loading: true });
  });

  it("never blanks a URL — a guest reports an empty one while it attaches", () => {
    // Letting this through blanks the tab, which snapshot() then filters out,
    // and the tab silently vanishes from the saved session.
    const s = state(["https://a.test"]);
    expect(patchTab(s, s.tabs[0].id, { url: "" }).tabs[0].url).toBe("https://a.test");
    expect(patchTab(s, s.tabs[0].id, { url: "   " }).tabs[0].url).toBe("https://a.test");
  });

  it("still applies the rest of a patch that carries a blank URL", () => {
    const s = state(["https://a.test"]);
    const out = patchTab(s, s.tabs[0].id, { url: "", title: "Home", loading: false });
    expect(out.tabs[0]).toMatchObject({ url: "https://a.test", title: "Home" });
  });

  it("accepts a real URL change", () => {
    const s = state(["https://a.test"]);
    expect(patchTab(s, s.tabs[0].id, { url: "https://b.test" }).tabs[0].url).toBe("https://b.test");
  });
});

describe("readiness", () => {
  it("starts un-ready and is tracked per tab", () => {
    const s = state(["a", "b"]);
    expect(s.tabs[0].ready).toBe(false);
    const out = patchTab(s, s.tabs[1].id, { ready: true });
    // Marking one tab ready must not imply anything about the other — a shared
    // flag would leave a freshly focused tab looking ready when it is not.
    expect(out.tabs[0].ready).toBe(false);
    expect(out.tabs[1].ready).toBe(true);
  });

  it("is not persisted — it is a live property of the guest", () => {
    const s = patchTab(state(["https://a.test"]), "t-none", {});
    const ws = snapshot({ ...s, tabs: s.tabs.map((t) => ({ ...t, ready: true })) }, []);
    expect(JSON.stringify(ws)).not.toContain("ready");
  });

  it("restored tabs come back un-ready, awaiting their own guest", () => {
    const back = restore({ tabs: ["https://a.test", "https://b.test"], active: 0, bookmarks: [] }, "home");
    expect(back.tabs.every((t) => !t.ready)).toBe(true);
  });
});

describe("snapshot resilience", () => {
  it("keeps every tab that has a URL", () => {
    const s = state(["https://a.test", "https://b.test", "https://c.test"], 2);
    expect(snapshot(s, []).tabs).toHaveLength(3);
  });
});

describe("restore / snapshot", () => {
  it("round-trips a session", () => {
    const s = state(["https://a.test", "https://b.test", "https://c.test"], 2);
    const ws = snapshot(s, []);
    expect(ws).toMatchObject({ tabs: ["https://a.test", "https://b.test", "https://c.test"], active: 2 });

    const back = restore(ws, "https://fallback.test");
    expect(back.tabs.map((t) => t.url)).toEqual(ws.tabs);
    expect(back.tabs.findIndex((t) => t.id === back.activeId)).toBe(2);
  });

  it("opens a fallback tab when the session is empty", () => {
    const back = restore(EMPTY_WORKSPACE, "https://home.test");
    expect(back.tabs.map((t) => t.url)).toEqual(["https://home.test"]);
    expect(back.activeId).toBe(back.tabs[0].id);
  });

  it("clamps an out-of-range active index instead of losing focus", () => {
    const back = restore({ tabs: ["a", "b"], active: 9, bookmarks: [] }, "home");
    expect(back.activeId).toBe(back.tabs[1].id);
  });

  it("drops junk entries from a hand-edited file", () => {
    const back = restore(
      { tabs: ["https://a.test", "", "   ", null as unknown as string], active: 0, bookmarks: [] },
      "home",
    );
    expect(back.tabs.map((t) => t.url)).toEqual(["https://a.test"]);
  });

  it("gives every restored tab a distinct id", () => {
    const back = restore({ tabs: ["a", "a", "a"], active: 0, bookmarks: [] }, "home");
    expect(new Set(back.tabs.map((t) => t.id)).size).toBe(3);
  });
});

describe("bookmarks", () => {
  it("adds, and renames rather than duplicating the same URL", () => {
    let list = addBookmark([], { url: "https://a.test", title: "A" });
    list = addBookmark(list, { url: "https://b.test", title: "B" });
    list = addBookmark(list, { url: "https://a.test", title: "A renamed" });
    expect(list).toEqual([
      { url: "https://a.test", title: "A renamed" },
      { url: "https://b.test", title: "B" },
    ]);
  });

  it("falls back to the URL when no title is given", () => {
    expect(addBookmark([], { url: "https://a.test", title: "  " }))
      .toEqual([{ url: "https://a.test", title: "https://a.test" }]);
  });

  it("refuses a blank URL", () => {
    expect(addBookmark([], { url: "   ", title: "x" })).toEqual([]);
  });

  it("removes and reports membership", () => {
    const list = addBookmark([], { url: "https://a.test", title: "A" });
    expect(isBookmarked(list, "https://a.test")).toBe(true);
    expect(removeBookmark(list, "https://a.test")).toEqual([]);
    expect(isBookmarked([], "https://a.test")).toBe(false);
  });
});

describe("tabLabel", () => {
  it("prefers the page title", () => {
    expect(tabLabel({ ...newTab("https://a.test/x"), title: "Cart" })).toBe("Cart");
  });

  it("falls back to the last path segment, then the host", () => {
    expect(tabLabel(newTab("https://shop.test/checkout/step-2"))).toBe("step-2");
    expect(tabLabel(newTab("https://shop.test/"))).toBe("shop.test");
  });

  it("survives a non-http URL", () => {
    expect(tabLabel(newTab("about:blank"))).toBe("about:blank");
    expect(tabLabel(newTab(""))).toBe("New tab");
  });
});
