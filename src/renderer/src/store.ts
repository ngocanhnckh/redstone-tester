import { create } from "zustand";
import type {
  Annotation, AppSettings, CaptureContext, Step, Ticket,
} from "../../shared/types.js";
import { DEFAULT_SETTINGS } from "../../shared/types.js";
import type { Review } from "../../main/llm.js";
import type { AuthChallenge } from "../../main/auth.js";
import type { AnnotateMode } from "./guest.js";
import { FIT } from "./devices.js";
import {
  Bookmark, DEFAULT_QUEUE, QueuePrefs, Tab, TabState,
  addBookmark, addTab, closeTab, patchTab, removeBookmark,
} from "../../shared/tabs.js";

/** How many recorded actions we keep. Enough for a long flow, bounded so a page
 *  that fires events in a loop can't grow the buffer without limit. */
const STEP_CAP = 200;
const ERROR_CAP = 40;

export type Orientation = "portrait" | "landscape";

/** The project this window is testing. Read from the URL hash the main process
 *  set at creation, so a second window opens straight into its own project. */
function initialProject(): string {
  const m = /[#&]project=([^&]+)/.exec(window.location.hash);
  return m ? decodeURIComponent(m[1]) : "";
}

export interface State {
  settings: AppSettings;
  settingsOpen: boolean;
  ready: boolean;

  /** Jira project for THIS window. Empty until chosen. */
  project: string;
  /** Shown once, when Jira is configured but this window has no project yet. */
  projectPickerOpen: boolean;

  // browser
  tabs: Tab[];
  activeId: string;
  bookmarks: Bookmark[];
  /** True once a project's saved session has been restored, so the persistence
   *  effect can't write an empty strip over a real one during the swap. */
  hydrated: boolean;

  url: string;
  title: string;
  loading: boolean;
  viewport: { w: number; h: number };
  userAgent: string;
  deviceId: string;
  orientation: Orientation;

  // capture
  mode: AnnotateMode;
  annotations: Annotation[];
  /** Why the capture overlay failed to arm on this page, if it did. Silent
   *  failure here reads to the tester as "the tool is broken". */
  armError: string | null;

  /** Recording is explicit: nothing is logged until the tester starts it, so the
   *  steps are the ones they meant to record, not everything since launch. */
  recording: boolean;
  steps: Step[];
  stepsOpen: boolean;
  consoleErrors: string[];

  capture: CaptureContext | null;
  ticket: Ticket | null;
  aiReview: Review | null;
  aiAnswers: Record<string, string>;

  /** An HTTP auth challenge awaiting the tester. */
  authChallenge: AuthChallenge | null;

  /** The queue sidebar's filter, restored with the project's workspace. */
  queue: QueuePrefs;
  /** Issue key open in the detail pane, or "" for the list. */
  openIssue: string;

  setSettings: (s: AppSettings) => void;
  openSettings: (open: boolean) => void;
  setProject: (key: string) => void;
  openProjectPicker: (open: boolean) => void;
  setNav: (p: Partial<Pick<State, "url" | "title" | "loading" | "viewport" | "userAgent">>) => void;

  openTab: (url: string, focus?: boolean) => void;
  shutTab: (id: string) => void;
  focusTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<Tab>) => void;
  hydrate: (state: TabState, bookmarks: Bookmark[], queue: QueuePrefs) => void;
  setQueue: (patch: Partial<QueuePrefs>) => void;
  setOpenIssue: (key: string) => void;
  bookmark: (entry: Bookmark) => void;
  unbookmark: (url: string) => void;
  setDevice: (id: string) => void;
  setOrientation: (o: Orientation) => void;
  setMode: (m: AnnotateMode) => void;
  setArmError: (e: string | null) => void;

  addAnnotation: (a: Annotation) => void;
  patchAnnotation: (id: number, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: number) => void;
  clearAnnotations: () => void;

  setRecording: (on: boolean) => void;
  addStep: (s: Step) => void;
  removeStep: (index: number) => void;
  openSteps: (open: boolean) => void;
  addConsoleError: (e: string) => void;
  clearSteps: () => void;

  openComposer: (ctx: CaptureContext, ticket: Ticket) => void;
  closeComposer: () => void;
  setTicket: (t: Ticket) => void;
  setReview: (r: Review | null) => void;
  setAnswer: (id: string, answer: string) => void;
  setAuthChallenge: (c: AuthChallenge | null) => void;
}

export const useStore = create<State>((set) => ({
  settings: DEFAULT_SETTINGS,
  settingsOpen: false,
  ready: false,

  project: initialProject(),
  projectPickerOpen: false,

  tabs: [],
  activeId: "",
  bookmarks: [],
  hydrated: false,

  url: "",
  title: "",
  loading: false,
  viewport: { w: 0, h: 0 },
  userAgent: "",
  deviceId: FIT.id,
  orientation: "portrait",

  mode: "off",
  annotations: [],
  armError: null,

  recording: false,
  steps: [],
  stepsOpen: false,
  consoleErrors: [],

  capture: null,
  ticket: null,
  aiReview: null,
  aiAnswers: {},
  authChallenge: null,

  queue: { ...DEFAULT_QUEUE },
  openIssue: "",

  setSettings: (settings) => set({ settings, ready: true }),
  openSettings: (settingsOpen) => set({ settingsOpen }),
  // Changing project swaps the whole workspace: its tabs and bookmarks are
  // loaded by an effect, which `hydrated: false` re-arms.
  setProject: (project) => set({ project, projectPickerOpen: false, hydrated: false }),
  openProjectPicker: (projectPickerOpen) => set({ projectPickerOpen }),
  setNav: (p) => set(p),

  openTab: (url, focus = true) => set((s) => addTab({ tabs: s.tabs, activeId: s.activeId }, url, focus)),
  // Closing the last tab opens a fresh one rather than leaving a blank window —
  // there is always something to test.
  shutTab: (id) => set((s) => {
    const next = closeTab({ tabs: s.tabs, activeId: s.activeId }, id);
    return next.tabs.length ? next : addTab(next, s.settings.homeUrl);
  }),
  focusTab: (activeId) => set({ activeId }),
  updateTab: (id, patch) => set((s) => patchTab({ tabs: s.tabs, activeId: s.activeId }, id, patch)),
  // Switching project swaps the queue with everything else, and closes whatever
  // issue was open — it belongs to the project we just left.
  hydrate: (state, bookmarks, queue) => set({
    tabs: state.tabs, activeId: state.activeId, bookmarks, queue, openIssue: "", hydrated: true,
  }),
  setQueue: (patch) => set((s) => ({ queue: { ...s.queue, ...patch } })),
  setOpenIssue: (openIssue) => set({ openIssue }),
  bookmark: (entry) => set((s) => ({ bookmarks: addBookmark(s.bookmarks, entry) })),
  unbookmark: (url) => set((s) => ({ bookmarks: removeBookmark(s.bookmarks, url) })),
  setDevice: (deviceId) => set({ deviceId }),
  setOrientation: (orientation) => set({ orientation }),
  // Arming a mode clears the previous page's failure — it is per-attempt.
  setMode: (mode) => set({ mode, armError: null }),
  setArmError: (armError) => set({ armError }),

  addAnnotation: (a) => set((s) => ({ annotations: [...s.annotations, a] })),
  patchAnnotation: (id, patch) => set((s) => ({
    annotations: s.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  })),
  removeAnnotation: (id) => set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),
  clearAnnotations: () => set({ annotations: [] }),

  // Starting a recording clears the previous one: "record" means this run, and a
  // ticket built from two interleaved runs reproduces neither.
  setRecording: (recording) => set(recording ? { recording, steps: [], consoleErrors: [] } : { recording }),

  addStep: (st) => set((s) => {
    if (!s.recording) return s;
    const last = s.steps[s.steps.length - 1];
    // Collapse identical consecutive actions (double-fired listeners, repeated
    // clicks on the same control) — they add noise, never information.
    if (last && last.kind === st.kind && last.text === st.text && st.t - last.t < 1200) return s;
    return { steps: [...s.steps, st].slice(-STEP_CAP) };
  }),
  removeStep: (index) => set((s) => ({ steps: s.steps.filter((_, i) => i !== index) })),
  openSteps: (stepsOpen) => set({ stepsOpen }),

  addConsoleError: (e) => set((s) => (
    s.consoleErrors.includes(e) ? s : { consoleErrors: [...s.consoleErrors, e].slice(-ERROR_CAP) }
  )),
  clearSteps: () => set({ steps: [], consoleErrors: [] }),

  openComposer: (capture, ticket) =>
    set({ capture, ticket, mode: "off", aiReview: null, aiAnswers: {} }),
  closeComposer: () => set({ capture: null, ticket: null, aiReview: null, aiAnswers: {} }),
  setTicket: (ticket) => set({ ticket }),
  setReview: (aiReview) => set({ aiReview }),
  setAnswer: (id, answer) => set((s) => ({ aiAnswers: { ...s.aiAnswers, [id]: answer } })),
  setAuthChallenge: (authChallenge) => set({ authChallenge }),
}));
