// Settings persistence. A single JSON file in Electron's userData dir. Secrets
// (Jira PAT, LLM key) live here too — the file is chmod 0600 so it is no more
// exposed than the user's own shell history, and shipping a keychain dependency
// for a local testing tool isn't worth the install friction.

import { app } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { AppSettings, DEFAULT_SETTINGS } from "../shared/types.js";

const FILE = () => join(app.getPath("userData"), "settings.json");

/** Deep-merge stored settings over the defaults so a config written by an older
 *  version never leaves a new field undefined. */
function merge(stored: unknown): AppSettings {
  const s = (stored ?? {}) as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    jira: { ...DEFAULT_SETTINGS.jira, ...(s.jira ?? {}) },
    llm: { ...DEFAULT_SETTINGS.llm, ...(s.llm ?? {}) },
  };
}

let cache: AppSettings | null = null;

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache;
  try {
    cache = merge(JSON.parse(await fs.readFile(FILE(), "utf8")));
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

export async function saveSettings(next: AppSettings): Promise<AppSettings> {
  cache = merge(next);
  const path = FILE();
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(path, JSON.stringify(cache, null, 2), { mode: 0o600 });
  // writeFile's mode only applies on create — enforce it on every save.
  await fs.chmod(path, 0o600).catch(() => {});
  return cache;
}

/** True when there's enough Jira config to attempt a submit. Drives the UI's
 *  "Create issue" vs "Copy to clipboard" fork. */
export function jiraConfigured(s: AppSettings): boolean {
  const j = s.jira;
  if (!j.endpoint || !j.token || !j.projectKey) return false;
  if (j.deployment === "cloud" && !j.email) return false;
  return true;
}
