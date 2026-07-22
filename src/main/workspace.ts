// Per-project workspaces: which tabs were open, which one was focused, and the
// project's bookmarks. Stored separately from settings because this is churny
// state written on every navigation, and a corrupt write here must never be able
// to take the user's Jira credentials down with it.

import { app } from "electron";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { EMPTY_WORKSPACE, Workspace } from "../shared/tabs.js";

/** Windows with no Jira project still get a remembered session, under this key. */
export const NO_PROJECT = "__local__";

const FILE = () => join(app.getPath("userData"), "workspaces.json");

type Store = Record<string, Workspace>;

let cache: Store | null = null;

function sane(w: unknown): Workspace {
  const o = (w ?? {}) as Partial<Workspace>;
  return {
    tabs: Array.isArray(o.tabs) ? o.tabs.filter((t): t is string => typeof t === "string") : [],
    active: typeof o.active === "number" && o.active >= 0 ? Math.floor(o.active) : 0,
    bookmarks: Array.isArray(o.bookmarks)
      ? o.bookmarks
        .filter((b): b is { url: string; title: string } =>
          Boolean(b) && typeof (b as { url?: unknown }).url === "string")
        .map((b) => ({ url: b.url, title: typeof b.title === "string" ? b.title : b.url }))
      : [],
  };
}

async function load(): Promise<Store> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await fs.readFile(FILE(), "utf8")) as Record<string, unknown>;
    cache = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, sane(v)]));
  } catch {
    cache = {};
  }
  return cache;
}

export function key(project: string): string {
  return project.trim() || NO_PROJECT;
}

export async function getWorkspace(project: string): Promise<Workspace> {
  const store = await load();
  return store[key(project)] ?? { ...EMPTY_WORKSPACE };
}

export async function setWorkspace(project: string, ws: Workspace): Promise<Workspace> {
  const store = await load();
  const clean = sane(ws);
  store[key(project)] = clean;
  const path = FILE();
  await fs.mkdir(dirname(path), { recursive: true });
  // Write-then-rename: a crash mid-write leaves the previous session intact
  // rather than a truncated file that loses every project's tabs.
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, path);
  return clean;
}
