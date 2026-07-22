// HTTP Basic/Digest and proxy authentication.
//
// Chromium's own credential sheet is not available to an embedded <webview>, so
// without this a staging site behind Basic auth simply fails to load with no
// explanation. Electron surfaces the challenge as an app-level `login` event;
// we answer it from a prompt in the cockpit, and optionally remember the
// credentials per origin+realm — QA staging sites are behind Basic auth often
// enough that re-typing it every load is the difference between usable and not.
//
// Credentials live in their own 0600 file, never in settings.json, so "forget my
// logins" is a single file deletion and a settings export can never carry them.

import { app, BrowserWindow, WebContents } from "electron";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { IPC } from "../shared/ipc.js";

export interface AuthChallenge {
  id: number;
  /** `https://staging.example.com` — what the tester recognises. */
  origin: string;
  /** The server's realm string, if it sent one. */
  realm: string;
  isProxy: boolean;
  /** True when saved credentials were just rejected, so the prompt can say so. */
  retry: boolean;
}

export interface AuthAnswer {
  id: number;
  username: string;
  password: string;
  remember: boolean;
  cancelled: boolean;
}

interface Stored { username: string; password: string }

const FILE = () => join(app.getPath("userData"), "logins.json");

let store: Record<string, Stored> | null = null;

/**
 * Identity of a challenge: the credentials that satisfy one origin+realm satisfy
 * every request to it, and nothing else. Port matters (a staging app on :8443 is
 * not the one on :443); the path never does.
 */
export function authKey(url: string, realm: string, isProxy: boolean): string {
  return `${isProxy ? "proxy" : "web"}|${displayOrigin(url)}|${realm || ""}`;
}

/**
 * The origin to show, and to key credentials by.
 *
 * A proxy challenge arrives as a bare `host:port`, which `new URL` happily
 * parses as a scheme — `new URL("proxy.corp:3128").origin` is the string
 * "null". Left unchecked that collapses every proxy onto one key, so one
 * proxy's password would be offered to another. Only trust a parse that
 * actually produced a web origin.
 */
export function displayOrigin(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return url;
    return u.origin;
  } catch {
    return url;
  }
}

async function load(): Promise<Record<string, Stored>> {
  if (store) return store;
  try {
    const raw = JSON.parse(await fs.readFile(FILE(), "utf8")) as Record<string, unknown>;
    store = {};
    for (const [k, v] of Object.entries(raw)) {
      const o = v as Partial<Stored>;
      if (typeof o?.username === "string" && typeof o?.password === "string") {
        store[k] = { username: o.username, password: o.password };
      }
    }
  } catch {
    store = {};
  }
  return store;
}

async function persist(): Promise<void> {
  const path = FILE();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(store ?? {}, null, 2), { mode: 0o600 });
  await fs.chmod(path, 0o600).catch(() => {});
}

export async function savedCount(): Promise<number> {
  return Object.keys(await load()).length;
}

export async function forgetAll(): Promise<void> {
  store = {};
  await persist();
}

// ---------------------------------------------------------------------------

let nextId = 1;
/** The challenge key is held HERE, alongside the callback — never round-tripped
 *  through the renderer, so a malformed reply cannot write credentials under
 *  someone else's origin. */
const pending = new Map<number, { callback: (u?: string, p?: string) => void; key: string }>();

/** Keys we have just auto-filled. If the same challenge comes back while a key
 *  is in here, the stored password is wrong — so we drop it and ask, rather than
 *  retrying forever against a changed password. */
const autoFilled = new Set<string>();

/** The window that owns a guest, so the prompt appears over the right cockpit. */
function ownerWindow(wc: WebContents): BrowserWindow | null {
  const host = (wc as WebContents & { hostWebContents?: WebContents }).hostWebContents ?? wc;
  return BrowserWindow.fromWebContents(host) ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function registerAuthHandler(): void {
  app.on("login", (event, webContents, details, authInfo, callback) => {
    // Taking over the event is what stops Chromium cancelling the request.
    event.preventDefault();

    const isProxy = Boolean(authInfo.isProxy);
    const target = isProxy ? `${authInfo.host}:${authInfo.port}` : details.url;
    const key = authKey(target, authInfo.realm ?? "", isProxy);

    void (async () => {
      const saved = (await load())[key];
      if (saved && !autoFilled.has(key)) {
        autoFilled.add(key);
        // Clear the marker after the request has had time to succeed; a later
        // challenge for the same key is then treated as a fresh one.
        setTimeout(() => autoFilled.delete(key), 30_000);
        callback(saved.username, saved.password);
        return;
      }

      const retry = autoFilled.has(key);
      if (retry) {
        // The stored password was rejected — forget it rather than loop.
        autoFilled.delete(key);
        const s = await load();
        delete s[key];
        await persist();
      }

      const win = ownerWindow(webContents);
      if (!win || win.isDestroyed()) { callback(); return; }

      const id = nextId++;
      pending.set(id, { callback, key });
      const challenge: AuthChallenge = {
        id,
        origin: isProxy ? target : displayOrigin(details.url),
        realm: authInfo.realm ?? "",
        isProxy,
        retry,
      };
      win.webContents.send(IPC.authRequest, challenge);
      win.focus();
    })();
  });
}

/** Answer a prompt. Cancelling completes the callback with nothing, which makes
 *  Chromium fail the request cleanly instead of hanging. */
export async function answerAuth(answer: AuthAnswer): Promise<void> {
  const entry = pending.get(answer.id);
  if (!entry) return;
  pending.delete(answer.id);

  if (answer.cancelled || !answer.username) { entry.callback(); return; }

  if (answer.remember) {
    const s = await load();
    s[entry.key] = { username: answer.username, password: answer.password };
    await persist();
  }
  entry.callback(answer.username, answer.password);
}
