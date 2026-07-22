// Types shared across main / preload / renderer. Kept framework-free and dependency-free
// so the preload bundle stays tiny and the main process can import it directly.

import type { Lang, TicketStrings } from "./i18n.js";
import { DEFAULT_LANG } from "./i18n.js";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Which Jira flavour we talk to. The two differ in auth AND in how users are
 *  identified: Data Center/Server uses a bearer PAT + `name`, Cloud uses Basic
 *  (email:api-token) + `accountId`. Getting this wrong is the #1 setup failure. */
export type JiraDeployment = "datacenter" | "cloud";

export interface JiraSettings {
  /** Base URL, e.g. https://jira.example.com (no trailing slash). */
  endpoint: string;
  deployment: JiraDeployment;
  /** Personal access token (DC) or API token (Cloud). */
  token: string;
  /** Cloud only — the account email that pairs with the API token for Basic auth. */
  email: string;
  /** Default project key, e.g. "RTT". */
  projectKey: string;
  /** Issue type name used for filed bugs. */
  issueType: string;
  /** Push the created issue into the board's active sprint. */
  autoAddToSprint: boolean;
  /** Board to take the active sprint from. Empty = auto-detect the project's first board. */
  boardId: string;
  /** Extra labels stamped on every ticket. */
  labels: string[];
}

export interface LlmSettings {
  /** OpenAI-compatible base, e.g. https://api.openai.com/v1 or a local gateway. */
  endpoint: string;
  apiKey: string;
  model: string;
  /** Send the screenshot alongside the text so the model can see the defect. */
  vision: boolean;
  /** Language the AI asks its questions and writes its critique in — read by the
   *  tester. Free-form language name, so any language works. */
  questionLang: Lang;
  /** Language the TICKET is written in — read by whoever fixes the bug. Wholly
   *  independent of `questionLang`: being asked in Vietnamese and filing in
   *  English is a normal setup, not an edge case. */
  ticketLang: Lang;
  /** Section headings the model has supplied for languages without a built-in
   *  translation, keyed by normalised language name. Cached so a ticket is not
   *  half-translated while offline or before the first review. */
  headings: Record<string, Partial<TicketStrings>>;
}

export interface AppSettings {
  jira: JiraSettings;
  llm: LlmSettings;
  /** Landing page for new sessions. */
  homeUrl: string;
  /** Reporter name stamped into the ticket footer; purely cosmetic. */
  tester: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  jira: {
    endpoint: "",
    deployment: "datacenter",
    token: "",
    email: "",
    projectKey: "",
    issueType: "Bug",
    autoAddToSprint: true,
    boardId: "",
    labels: ["redstone-tester"],
  },
  llm: {
    endpoint: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    vision: true,
    questionLang: DEFAULT_LANG,
    ticketLang: DEFAULT_LANG,
    headings: {},
  },
  homeUrl: "https://example.com",
  tester: "",
};

// ---------------------------------------------------------------------------
// Capture model — what the browser overlay hands back
// ---------------------------------------------------------------------------

export interface Box { x: number; y: number; w: number; h: number }

/** One highlighted defect: a DOM element the tester pinned, or a dragged region. */
export interface Annotation {
  id: number;
  kind: "element" | "region";
  note: string;
  /** CSS selector that re-finds the element (element kind only). */
  selector?: string;
  /** Human-readable ancestry, e.g. `main > div.card > button.primary`. */
  domPath?: string;
  /** Tag name + key attributes, for the ticket's DOM reference block. */
  tag?: string;
  attrs?: Record<string, string>;
  /** Visible text of the element, truncated. */
  text?: string;
  /** Computed styles worth reporting (colour/size/visibility defects). */
  styles?: Record<string, string>;
  box: Box;
  /** Viewport the box was measured in — makes the coordinates meaningful later. */
  vw: number;
  vh: number;
  url: string;
  /** data: URL of the cropped screenshot for this annotation. */
  shot?: string;
}

/** One recorded user action, replayed as a "steps to reproduce" line. */
export interface Step {
  t: number;
  kind: "navigate" | "click" | "input" | "submit" | "key" | "resize";
  /** Pre-rendered, human-readable sentence, e.g. `Click "Save changes" (button.primary)`. */
  text: string;
  url: string;
}

/** Everything gathered from the browser before the ticket is written. */
export interface CaptureContext {
  url: string;
  title: string;
  annotations: Annotation[];
  steps: Step[];
  /** Full-viewport screenshot at the moment of capture. */
  pageShot?: string;
  viewport: { w: number; h: number };
  /** Emulated device, rendered for the ticket, e.g. `iPhone 15 — 393x852 @3x`.
   *  Absent means the page was tested at the window's natural size. */
  device?: string;
  userAgent: string;
  /** Console errors + failed requests seen on the page — free evidence. */
  consoleErrors: string[];
}

// ---------------------------------------------------------------------------
// Ticket
// ---------------------------------------------------------------------------

export type Severity = "Blocker" | "Critical" | "Major" | "Minor" | "Trivial";

export interface Ticket {
  summary: string;
  /** Markdown. Converted to Jira wiki markup on submit. */
  description: string;
  stepsToReproduce: string[];
  expected: string;
  current: string;
  severity: Severity;
  environment: string;
  labels: string[];
}

// ---------------------------------------------------------------------------
// Jira wire types (only the fields we use)
// ---------------------------------------------------------------------------

export interface JiraUser {
  /** DC: `name`. Cloud: `accountId`. Whichever identifier the assignee field wants. */
  id: string;
  displayName: string;
  email?: string;
  avatar?: string;
  /** Open/recent issues already assigned to them in this project. Drives the
   *  ordering: whoever is already working here is the likely assignee. */
  issueCount?: number;
  /** True when they hold issues in this project — the "working on this" group. */
  active?: boolean;
}

export interface JiraProject { key: string; name: string }
export interface JiraBoard { id: number; name: string }
export interface JiraSprint { id: number; name: string; state: string }

/** A workflow status as the project defines it. `category` is Jira's own
 *  grouping (`new` / `indeterminate` / `done`), used only to colour the pill. */
export interface JiraStatus {
  id: string;
  name: string;
  category?: string;
}

/** One row in the tester's queue. Deliberately flat: the sidebar shows a list,
 *  and pulling the whole issue for every row would be a request per row. */
export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  statusCategory?: string;
  issueType?: string;
  priority?: string;
  assignee?: JiraUser;
  reporter?: JiraUser;
  /** ISO timestamp of the last change — what the queue is ordered by. */
  updated?: string;
  /** Browser URL, resolved here so the renderer never rebuilds Jira URLs. */
  url: string;
}

/** Everything the detail pane shows, fetched only when an issue is opened. */
export interface JiraIssueDetail extends JiraIssue {
  /** Raw Jira wiki markup. Rendered readably rather than as source. */
  description: string;
  labels: string[];
  created?: string;
  comments: JiraComment[];
  attachments: JiraAttachment[];
}

export interface JiraComment {
  id: string;
  author: string;
  authorAvatar?: string;
  body: string;
  created: string;
}

export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  created?: string;
  /** Authenticated content URL. Not usable directly by the renderer — it is
   *  fetched through the main process, which holds the credentials. */
  content: string;
  thumbnail?: string;
}

/** A move the workflow permits from the issue's CURRENT status. Which ones exist
 *  depends on the issue, so they are fetched per issue rather than guessed. */
export interface JiraTransition {
  id: string;
  name: string;
  /** Status the issue lands in. This, not `name`, is what the tester means. */
  to: string;
  toCategory?: string;
}

export interface CreatedIssue { key: string; url: string }

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
