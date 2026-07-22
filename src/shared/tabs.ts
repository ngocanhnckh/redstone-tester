// Tab list operations, kept pure so the focus rules — which are the fiddly part —
// are testable without a browser.

export interface Tab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  back: boolean;
  fwd: boolean;
  /** The guest accepts injection. Per-tab: a single shared flag goes stale the
   *  moment you switch tabs, because the tab you switch TO fired its dom-ready
   *  long ago and never reports again. Not persisted. */
  ready: boolean;
}

export interface TabState {
  tabs: Tab[];
  activeId: string;
}

/** Per-project persisted session. Only the URLs survive a restart — titles are
 *  re-read from the pages themselves, and stale ones would be worse than none. */
export interface Workspace {
  tabs: string[];
  /** Index into `tabs` of the tab that was focused. */
  active: number;
  bookmarks: Bookmark[];
}

export interface Bookmark {
  url: string;
  /** What the tester called it — defaults to the page title at save time. */
  title: string;
}

export const EMPTY_WORKSPACE: Workspace = { tabs: [], active: 0, bookmarks: [] };

let counter = 0;
/** Ids only need to be unique within a window's lifetime — they key React
 *  elements and a ref map, and are never persisted. */
export function tabId(): string {
  counter += 1;
  return `t${counter}`;
}

export function newTab(url: string): Tab {
  return { id: tabId(), url, title: "", loading: false, back: false, fwd: false, ready: false };
}

export function addTab(state: TabState, url: string, focus = true): TabState {
  const tab = newTab(url);
  return { tabs: [...state.tabs, tab], activeId: focus ? tab.id : state.activeId };
}

/**
 * Close a tab and decide what to focus.
 *
 * Closing the active tab focuses its right-hand neighbour, falling back to the
 * left — the same rule every browser uses, and the one that keeps a "close a run
 * of tabs" gesture from jumping the focus across the strip. Closing the last tab
 * leaves an empty list; the caller decides whether that means a fresh tab or a
 * closed window.
 */
export function closeTab(state: TabState, id: string): TabState {
  const i = state.tabs.findIndex((t) => t.id === id);
  if (i < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (!tabs.length) return { tabs, activeId: "" };
  if (state.activeId !== id) return { tabs, activeId: state.activeId };
  const next = tabs[Math.min(i, tabs.length - 1)];
  return { tabs, activeId: next.id };
}

/**
 * Update one tab.
 *
 * A blank `url` in the patch is dropped. A guest reports an empty URL while it is
 * attaching or tearing down — most visibly for a background tab, which attaches
 * lazily — and letting that through blanks the tab's URL, which then gets
 * filtered out of `snapshot` and silently disappears from the saved session.
 */
export function patchTab(state: TabState, id: string, patch: Partial<Tab>): TabState {
  const safe = patch.url !== undefined && !patch.url.trim()
    ? (({ url: _drop, ...rest }) => rest)(patch)
    : patch;
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...safe } : t)) };
}

/** Restore a saved session. A workspace with no tabs opens one at `fallback`, so
 *  the window is never left with nothing to test. */
export function restore(ws: Workspace, fallback: string): TabState {
  const urls = ws.tabs.filter((u) => typeof u === "string" && u.trim());
  if (!urls.length) {
    const tab = newTab(fallback);
    return { tabs: [tab], activeId: tab.id };
  }
  const tabs = urls.map(newTab);
  const idx = Math.max(0, Math.min(ws.active ?? 0, tabs.length - 1));
  return { tabs, activeId: tabs[idx].id };
}

/** What to persist for the current tab strip. */
export function snapshot(state: TabState, bookmarks: Bookmark[]): Workspace {
  return {
    tabs: state.tabs.map((t) => t.url).filter(Boolean),
    active: Math.max(0, state.tabs.findIndex((t) => t.id === state.activeId)),
    bookmarks,
  };
}

/** Add a bookmark, or update the title if the URL is already saved — the same
 *  page bookmarked twice is a mistake, not two bookmarks. */
export function addBookmark(list: Bookmark[], entry: Bookmark): Bookmark[] {
  const url = entry.url.trim();
  if (!url) return list;
  const title = entry.title.trim() || url;
  const i = list.findIndex((b) => b.url === url);
  if (i < 0) return [...list, { url, title }];
  return list.map((b, j) => (j === i ? { url, title } : b));
}

export function removeBookmark(list: Bookmark[], url: string): Bookmark[] {
  return list.filter((b) => b.url !== url);
}

export function isBookmarked(list: Bookmark[], url: string): boolean {
  return list.some((b) => b.url === url);
}

/** A short label for a tab: the page title, else the last path segment, else the
 *  host. Falls back to the raw string for non-http URLs. */
export function tabLabel(tab: Tab): string {
  if (tab.title.trim()) return tab.title.trim();
  try {
    const u = new URL(tab.url);
    // Only web URLs have a path worth summarising. `about:blank` parses fine and
    // would otherwise be labelled "blank", which reads like a page name.
    if (u.protocol !== "http:" && u.protocol !== "https:") return tab.url;
    const seg = u.pathname.split("/").filter(Boolean).pop();
    return seg || u.host;
  } catch {
    return tab.url || "New tab";
  }
}
