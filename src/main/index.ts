// Main process: one frameless window hosting the React cockpit. The page under
// test lives in a <webview> inside the renderer (not a WebContentsView) so the
// annotation overlay, screenshots and JS injection all stay in renderer code and
// the guest can never reach Node. The one native view here is the docked
// inspector, which has no choice — see the note above `docks`.

import {
  app, BrowserWindow, clipboard, ipcMain, shell, session, nativeImage, webContents, WebContentsView,
} from "electron";
import { join } from "node:path";
import { AppSettings, CaptureContext, DockBounds, Result } from "../shared/types.js";
import { jiraConfigured, loadSettings, saveSettings } from "./settings.js";
import * as jira from "./jira.js";
import { review, ReviewInput } from "./llm.js";
import { getWorkspace, setWorkspace } from "./workspace.js";
import { AuthAnswer, answerAuth, forgetAll, registerAuthHandler, savedCount } from "./auth.js";
import type { Workspace } from "../shared/tabs.js";
import { IPC } from "../shared/ipc.js";

/** Each window tests one Jira project. A second window is a genuinely separate
 *  session — its own project, its own capture, its own recording — so the
 *  project is passed in at creation and never shared through main-process state. */
function createWindow(project?: string): BrowserWindow {
  const offset = BrowserWindow.getAllWindows().length * 28;
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1080,
    minHeight: 680,
    // Cascade so a second window doesn't land exactly on top of the first.
    x: offset ? offset + 40 : undefined,
    y: offset ? offset + 40 : undefined,
    show: false,
    backgroundColor: "#15110D",
    // Window chrome is per-platform. `hiddenInset` and `trafficLightPosition`
    // are macOS-only: applying them elsewhere yields a window with no caption
    // buttons at all, i.e. one you can only close with Alt+F4. Windows keeps a
    // custom title bar but gets the real caption buttons drawn over it.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 16 } }
      : process.platform === "win32"
        ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: { color: "#15110D", symbolColor: "#F4F1E9", height: 44 },
        }
        : {}),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      // The whole product is "drive a site and inspect it" — the guest needs the
      // <webview> tag. Guests get no preload and no node integration.
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // The dock is a native child view rather than DOM, so no amount of the page
  // going away releases it: reloading the cockpit tears down React without
  // running a single cleanup, and closing the window never involved React at
  // all. Neither currently strands a *visible* inspector — Electron drops the
  // frontend when the guest it was inspecting dies with the renderer — but the
  // view object itself outlives both, so it is released here rather than left
  // for whatever happens to come next.
  //
  // The id is captured rather than read inside the handlers: it survives
  // `closed` today, but the window is destroyed by then and the docs are
  // explicit that it should not be touched.
  const winId = win.id;
  win.once("closed", () => closeDock(winId));
  win.webContents.on("did-start-loading", () => closeDock(winId));

  // Anything the *cockpit* tries to open in a new window goes to the real
  // browser. This does not reach the guest: a page under test opens its popups
  // through its own webContents, which keeps Electron's default (a real popup
  // window) — an OAuth flow needs one, with a live `opener` to post back to.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // The window's project rides in the URL hash: it is available to the renderer
  // on its very first paint, so the project chip never flashes the wrong key.
  const hash = project ? `#project=${encodeURIComponent(project)}` : "";
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL + hash);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"), { hash });
  }
  return win;
}

app.whenReady().then(() => {
  // Sites gate features on the UA string; a bare Electron UA trips bot walls and
  // "unsupported browser" interstitials on the very apps testers need to open.
  const chromeUa = session.defaultSession.getUserAgent()
    .replace(/ Electron\/[\d.]+/, "")
    .replace(/ Redstone Tester\/[\d.]+/, "");
  session.defaultSession.setUserAgent(chromeUa);
  session.fromPartition("persist:rtt").setUserAgent(chromeUa);

  registerIpc();
  registerGuestKeys();
  // Must be installed before any window exists: a restored tab can challenge
  // for credentials during its very first load.
  registerAuthHandler();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/** Which cockpit window a key press inside a nested frame belongs to, or null if
 *  it belongs to none — the cockpit's own page included, since the renderer
 *  already handles its own keys. */
function ownerOfFrame(contents: Electron.WebContents): BrowserWindow | null {
  // The dock is a native view with no parent link to follow, but we put it
  // there, so we know whose it is.
  for (const [winId, dock] of docks) {
    if (dock.view.webContents.id === contents.id) return BrowserWindow.fromId(winId);
  }
  if (contents.getType() !== "webview") return null;
  // A guest belongs to the window it is embedded in. When that link cannot be
  // resolved, one open window is still unambiguous; several are not, and
  // toggling the wrong window's inspector is worse than doing nothing.
  const windows = BrowserWindow.getAllWindows();
  return BrowserWindow.fromWebContents(contents) ?? (windows.length === 1 ? windows[0] : null);
}

/**
 * F12 inside the page under test — or inside the inspector — toggles the dock,
 * the way it does in a browser.
 *
 * The key never reaches the cockpit on its own: both are separate frame trees,
 * so their key events are delivered there and stop. A `keydown` listener in the
 * renderer only ever sees keys pressed while the cockpit chrome has focus,
 * which is exactly not when a tester wants to inspect something.
 * `before-input-event` is the one place the host side can see them.
 */
function registerGuestKeys(): void {
  app.on("web-contents-created", (_e, contents) => {
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.key !== "F12") return;
      const win = ownerOfFrame(contents);
      if (!win) return;
      event.preventDefault();
      win.webContents.send(IPC.devtoolsToggle);
    });
  });
}

// ---------------------------------------------------------------------------
// The docked inspector
// ---------------------------------------------------------------------------

/**
 * The DevTools frontend has to live in a `WebContentsView`, not in a second
 * `<webview>`.
 *
 * Electron only grants the DevTools WebUI bindings — `window.DevToolsAPI`, and
 * with it the real `InspectorFrontendHostImpl` — to a genuine top-level
 * WebContents. Point `setDevToolsWebContents` at a `<webview>` guest and the
 * frontend still loads and paints perfectly: every panel renders, tabs switch,
 * settings persist. It just silently falls back to `InspectorFrontendHostStub`
 * and drops every protocol message on the floor. What you get is an inspector
 * with an empty DOM tree and a console that answers nothing, and not one error
 * anywhere saying why. The `<webview>` recipe for this is widely repeated and
 * no longer works.
 *
 * The cost of a native view is that it paints above ALL host DOM and ignores
 * CSS entirely: it cannot be laid out, only positioned, and it will happily
 * cover a modal. Hence `placeDock` and the renderer's visibility rule.
 */
interface Dock { view: WebContentsView; guestId: number }

/** One dock per cockpit window. A frontend WebContents is single-use — Electron
 *  is explicit that it must not be reused after the call — so pointing the
 *  inspector at a different tab replaces the view rather than re-aiming it. */
const docks = new Map<number, Dock>();

function placeDock(dock: Dock, box: DockBounds, visible: boolean): void {
  dock.view.setVisible(visible);
  // Nothing to place while hidden, and a stale rect costs nothing: the renderer
  // sends fresh bounds with the call that makes it visible again.
  if (!visible) return;
  dock.view.setBounds({
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.max(0, Math.round(box.width)),
    height: Math.max(0, Math.round(box.height)),
  });
}

function closeDock(winId: number): void {
  const dock = docks.get(winId);
  if (!dock) return;
  docks.delete(winId);
  const guest = webContents.fromId(dock.guestId);
  // Already gone if the tab was closed — which closed its DevTools with it.
  if (guest && !guest.isDestroyed() && guest.isDevToolsOpened()) guest.closeDevTools();
  const win = BrowserWindow.fromId(winId);
  if (win && !win.isDestroyed()) win.contentView.removeChildView(dock.view);
  if (!dock.view.webContents.isDestroyed()) dock.view.webContents.close();
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

/** Wrap a handler so an unexpected throw surfaces as a Result the UI can show
 *  instead of a rejected promise the renderer has to catch at every call site. */
function handle<A extends unknown[], T>(
  channel: string,
  fn: (...args: A) => Promise<Result<T>> | Promise<T>,
): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await fn(...(args as A));
    } catch (e) {
      return { ok: false, error: (e as Error).message } satisfies Result<never>;
    }
  });
}

/** Same, for the handlers that act on the calling window rather than the app —
 *  a second cockpit window has its own dock and must not touch this one's. */
function handleWin<A extends unknown[], T>(
  channel: string,
  fn: (win: BrowserWindow, ...args: A) => Promise<Result<T>>,
): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) return { ok: false, error: "This window is closing." } satisfies Result<never>;
      return await fn(win, ...(args as A));
    } catch (err) {
      return { ok: false, error: (err as Error).message } satisfies Result<never>;
    }
  });
}

function registerIpc(): void {
  handle(IPC.settingsGet, async () => await loadSettings());
  handle(IPC.settingsSet, async (next: AppSettings) => await saveSettings(next));
  handle(IPC.settingsStatus, async () => {
    const s = await loadSettings();
    return { jira: jiraConfigured(s), llm: Boolean(s.llm.endpoint && s.llm.model) };
  });

  handle(IPC.jiraTest, async () => await jira.testConnection(await loadSettings()));
  handle(IPC.jiraProjects, async () => await jira.listProjects(await loadSettings()));
  handle(IPC.jiraAssignees, async (q: string, project?: string) =>
    await jira.assigneeOptions(await loadSettings(), q, project));
  handle(IPC.jiraBoards, async (project?: string) =>
    await jira.listBoards(await loadSettings(), project));
  handle(IPC.jiraCreate, async (opts: jira.CreateOpts) => await jira.createIssue(await loadSettings(), opts));

  handle(IPC.jiraStatuses, async (project?: string) =>
    await jira.listStatuses(await loadSettings(), project));
  handle(IPC.jiraQueue, async (opts: jira.QueueOpts) =>
    await jira.listQueue(await loadSettings(), opts));
  handle(IPC.jiraIssue, async (key: string) => await jira.getIssue(await loadSettings(), key));
  handle(IPC.jiraTransitions, async (key: string) =>
    await jira.listTransitions(await loadSettings(), key));
  handle(IPC.jiraTransition, async (key: string, transitionId: string) =>
    await jira.transitionIssue(await loadSettings(), key, transitionId));
  handle(IPC.jiraComment, async (key: string, body: string) =>
    await jira.addComment(await loadSettings(), key, body));
  handle(IPC.jiraAttachment, async (url: string) =>
    await jira.fetchAttachment(await loadSettings(), url));
  handle(IPC.jiraRetest, async (opts: jira.RetestOpts) =>
    await jira.postRetest(await loadSettings(), opts));

  handle(IPC.llmReview, async (ctx: CaptureContext, input: ReviewInput) =>
    await review(await loadSettings(), ctx, input));

  handle(IPC.windowNew, async (project?: string) => {
    createWindow(project);
    return { ok: true, data: undefined } satisfies Result<undefined>;
  });

  handle(IPC.authRespond, async (answer: AuthAnswer) => {
    await answerAuth(answer);
    return { ok: true, data: undefined } satisfies Result<undefined>;
  });
  handle(IPC.authCount, async () => await savedCount());
  handle(IPC.authForget, async () => {
    await forgetAll();
    return { ok: true, data: undefined } satisfies Result<undefined>;
  });

  /** Open the inspector for a guest, rendered into this window's dock view. */
  handleWin(IPC.devtoolsAttach, async (win, guestId: number, box: DockBounds, visible: boolean) => {
    const guest = webContents.fromId(guestId);
    if (!guest || guest.isDestroyed()) {
      return { ok: false, error: "The page is no longer open." } satisfies Result<never>;
    }
    // One dock per window, and a used one is spent — see the note on `docks`.
    closeDock(win.id);
    const view = new WebContentsView();
    const dock: Dock = { view, guestId };
    docks.set(win.id, dock);
    win.contentView.addChildView(view);
    placeDock(dock, box, visible);
    // A frontend already up is bound to some other host; re-pointing the guest
    // without closing it first leaves that one orphaned and painting nothing.
    if (guest.isDevToolsOpened()) guest.closeDevTools();
    guest.setDevToolsWebContents(view.webContents);
    guest.openDevTools();
    return { ok: true, data: undefined } satisfies Result<undefined>;
  });

  /** The dock is a native view: it knows nothing of the layout it sits in, so
   *  the renderer measures its slot and tells us where to put it. */
  handleWin(IPC.devtoolsBounds, async (win, box: DockBounds, visible: boolean) => {
    const dock = docks.get(win.id);
    if (dock) placeDock(dock, box, visible);
    return { ok: true, data: undefined } satisfies Result<undefined>;
  });

  handleWin(IPC.devtoolsDetach, async (win) => {
    closeDock(win.id);
    return { ok: true, data: undefined } satisfies Result<undefined>;
  });

  handle(IPC.workspaceGet, async (project: string) => await getWorkspace(project));
  handle(IPC.workspaceSet, async (project: string, ws: Workspace) =>
    await setWorkspace(project, ws));

  handle(IPC.clipboardWrite, async (text: string) => {
    clipboard.writeText(text);
    return { ok: true, data: undefined } satisfies Result<undefined>;
  });

  /** Copy an image to the clipboard so a screenshot can be pasted straight into
   *  Slack/Jira when Jira isn't configured. */
  handle(IPC.clipboardImage, async (dataUrl: string) => {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
    return { ok: true, data: undefined } satisfies Result<undefined>;
  });

  handle(IPC.openExternal, async (url: string) => {
    await shell.openExternal(url);
    return { ok: true, data: undefined } satisfies Result<undefined>;
  });
}
