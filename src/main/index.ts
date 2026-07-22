// Main process: one frameless window hosting the React cockpit. The page under
// test lives in a <webview> inside the renderer (not a WebContentsView) so the
// annotation overlay, screenshots and JS injection all stay in renderer code and
// the guest can never reach Node.

import { app, BrowserWindow, clipboard, ipcMain, shell, session, nativeImage } from "electron";
import { join } from "node:path";
import { AppSettings, CaptureContext, Result } from "../shared/types.js";
import { jiraConfigured, loadSettings, saveSettings } from "./settings.js";
import * as jira from "./jira.js";
import { review, ReviewInput } from "./llm.js";
import { getWorkspace, setWorkspace } from "./workspace.js";
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

  // Anything the app itself tries to open in a new window goes to the real
  // browser; the guest's own popups are handled inside the renderer.
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
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

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

  handle(IPC.llmReview, async (ctx: CaptureContext, input: ReviewInput) =>
    await review(await loadSettings(), ctx, input));

  handle(IPC.windowNew, async (project?: string) => {
    createWindow(project);
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
