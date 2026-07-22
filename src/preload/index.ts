// The only bridge between the cockpit UI and Node. Everything is a typed method;
// no raw `ipcRenderer` is exposed, so a compromised page under test (which has no
// preload of its own anyway) has nothing to reach for.

import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc.js";
import type {
  AppSettings, CaptureContext, CreatedIssue, JiraBoard, JiraComment, JiraIssueDetail,
  JiraProject, JiraStatus, JiraTransition, JiraUser, Result,
} from "../shared/types.js";
import type { CreateOpts, Queue, QueueOpts } from "../main/jira.js";
import type { Review, ReviewInput } from "../main/llm.js";
import type { Workspace } from "../shared/tabs.js";
import type { AuthAnswer, AuthChallenge } from "../main/auth.js";

const api = {
  /** Drives title-bar padding: the caption buttons sit on the left on macOS and
   *  on the right on Windows, so the bar cannot be laid out platform-blind. */
  platform: process.platform,
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (s: AppSettings): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsSet, s),
    status: (): Promise<{ jira: boolean; llm: boolean }> => ipcRenderer.invoke(IPC.settingsStatus),
  },
  jira: {
    test: (): Promise<Result<string>> => ipcRenderer.invoke(IPC.jiraTest),
    projects: (): Promise<Result<JiraProject[]>> => ipcRenderer.invoke(IPC.jiraProjects),
    assignees: (q = "", project?: string): Promise<Result<JiraUser[]>> =>
      ipcRenderer.invoke(IPC.jiraAssignees, q, project),
    boards: (project?: string): Promise<Result<JiraBoard[]>> =>
      ipcRenderer.invoke(IPC.jiraBoards, project),
    create: (opts: CreateOpts): Promise<Result<CreatedIssue>> => ipcRenderer.invoke(IPC.jiraCreate, opts),

    /** The queue sidebar: what is sitting at a given status in this sprint, and
     *  everything needed to act on one without leaving the app. */
    statuses: (project?: string): Promise<Result<JiraStatus[]>> =>
      ipcRenderer.invoke(IPC.jiraStatuses, project),
    queue: (opts: QueueOpts): Promise<Result<Queue>> => ipcRenderer.invoke(IPC.jiraQueue, opts),
    issue: (key: string): Promise<Result<JiraIssueDetail>> => ipcRenderer.invoke(IPC.jiraIssue, key),
    transitions: (key: string): Promise<Result<JiraTransition[]>> =>
      ipcRenderer.invoke(IPC.jiraTransitions, key),
    transition: (key: string, transitionId: string): Promise<Result<void>> =>
      ipcRenderer.invoke(IPC.jiraTransition, key, transitionId),
    comment: (key: string, body: string): Promise<Result<JiraComment>> =>
      ipcRenderer.invoke(IPC.jiraComment, key, body),
    /** Attachments need the Jira credentials, which live in main — so the bytes
     *  come back as a data: URL the renderer can show directly. */
    attachment: (url: string): Promise<Result<string>> => ipcRenderer.invoke(IPC.jiraAttachment, url),
  },
  llm: {
    review: (ctx: CaptureContext, input: ReviewInput): Promise<Result<Review>> =>
      ipcRenderer.invoke(IPC.llmReview, ctx, input),
  },
  /** HTTP Basic/Digest and proxy authentication for the page under test. */
  auth: {
    /** Main pushes a challenge; the cockpit shows a prompt. */
    onRequest: (cb: (c: AuthChallenge) => void): (() => void) => {
      const listener = (_e: unknown, c: AuthChallenge) => cb(c);
      ipcRenderer.on(IPC.authRequest, listener);
      return () => { ipcRenderer.removeListener(IPC.authRequest, listener); };
    },
    respond: (answer: AuthAnswer): Promise<Result<void>> =>
      ipcRenderer.invoke(IPC.authRespond, answer),
    savedCount: (): Promise<number> => ipcRenderer.invoke(IPC.authCount),
    forgetAll: (): Promise<Result<void>> => ipcRenderer.invoke(IPC.authForget),
  },
  /** Per-project tabs and bookmarks, so a project reopens where it was left. */
  workspace: {
    get: (project: string): Promise<Workspace> => ipcRenderer.invoke(IPC.workspaceGet, project),
    set: (project: string, ws: Workspace): Promise<Workspace> =>
      ipcRenderer.invoke(IPC.workspaceSet, project, ws),
  },
  /** Open a second cockpit, optionally bound to a different Jira project. */
  newWindow: (project?: string): Promise<Result<void>> => ipcRenderer.invoke(IPC.windowNew, project),
  clipboard: {
    text: (t: string): Promise<Result<void>> => ipcRenderer.invoke(IPC.clipboardWrite, t),
    image: (dataUrl: string): Promise<Result<void>> => ipcRenderer.invoke(IPC.clipboardImage, dataUrl),
  },
  openExternal: (url: string): Promise<Result<void>> => ipcRenderer.invoke(IPC.openExternal, url),
};

export type TesterApi = typeof api;

contextBridge.exposeInMainWorld("tester", api);
