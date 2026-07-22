// Jira REST client covering both self-hosted Data Center/Server and Cloud.
//
// The two deployments diverge in three places and nowhere else that we care about:
//   auth      DC: `Authorization: Bearer <PAT>`   Cloud: Basic base64(email:token)
//   users     DC: identified by `name`            Cloud: by `accountId`
//   agile API DC exposes /rest/agile/1.0 only when Jira Software is installed.
// Everything else is shared, so the deployment flag is threaded through a few
// small helpers rather than forking the whole client.

import {
  AppSettings, CreatedIssue, JiraAttachment, JiraBoard, JiraComment, JiraIssue,
  JiraIssueDetail, JiraProject, JiraSprint, JiraStatus, JiraTransition, JiraUser, Result,
} from "../shared/types.js";
import { markdownToJira } from "../shared/jiraMarkup.js";

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = <T>(error: string): Result<T> => ({ ok: false, error });

function base(s: AppSettings): string {
  return s.jira.endpoint.replace(/\/+$/, "");
}

/** The project a call applies to. Each window picks its own project, so the
 *  saved default is only a fallback — never read `s.jira.projectKey` directly
 *  below or a second window will silently file into the first one's project. */
function projectOf(s: AppSettings, override?: string): string {
  return (override || s.jira.projectKey || "").trim();
}

function authHeader(s: AppSettings): string {
  if (s.jira.deployment === "cloud") {
    return "Basic " + Buffer.from(`${s.jira.email}:${s.jira.token}`).toString("base64");
  }
  return `Bearer ${s.jira.token}`;
}

/** Jira error bodies come back in three different shapes depending on the endpoint
 *  and version. Squash them into one readable line so the UI can just show it. */
async function explain(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  try {
    const j = JSON.parse(raw) as {
      errorMessages?: string[];
      errors?: Record<string, string>;
      message?: string;
    };
    const parts = [
      ...(j.errorMessages ?? []),
      ...Object.entries(j.errors ?? {}).map(([k, v]) => `${k}: ${v}`),
      ...(j.message ? [j.message] : []),
    ];
    if (parts.length) return `${res.status} — ${parts.join("; ")}`;
  } catch { /* not JSON — fall through */ }
  return `${res.status} ${res.statusText}${raw ? ` — ${raw.slice(0, 300)}` : ""}`;
}

async function api<T>(
  s: AppSettings,
  path: string,
  init: RequestInit = {},
): Promise<Result<T>> {
  const url = `${base(s)}${path}`;
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: authHeader(s),
        Accept: "application/json",
        ...(init.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        // Required by Jira for any non-GET that isn't a browser form post.
        "X-Atlassian-Token": "no-check",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) return err(await explain(res));
    if (res.status === 204) return ok(undefined as T);
    const text = await res.text();
    return ok((text ? JSON.parse(text) : undefined) as T);
  } catch (e) {
    return err(`Cannot reach ${url} — ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Round-trip that proves endpoint + credentials work, and names who we are. */
export async function testConnection(s: AppSettings): Promise<Result<string>> {
  const r = await api<{ displayName?: string; name?: string; emailAddress?: string }>(
    s,
    s.jira.deployment === "cloud" ? "/rest/api/3/myself" : "/rest/api/2/myself",
  );
  if (!r.ok) return r;
  return ok(r.data.displayName || r.data.name || r.data.emailAddress || "connected");
}

export async function listProjects(s: AppSettings): Promise<Result<JiraProject[]>> {
  const r = await api<Array<{ key: string; name: string }>>(s, "/rest/api/2/project");
  if (!r.ok) return r;
  return ok(r.data.map((p) => ({ key: p.key, name: p.name })));
}

/**
 * Users the issue can be assigned to.
 *
 * The parameter this endpoint wants has changed across versions, and getting it
 * wrong returns an empty list rather than an error — which shows up as a missing
 * assignee picker with nothing to explain it. So try the known spellings in turn
 * and take the first that yields anyone.
 */
export async function listAssignees(
  s: AppSettings, query = "", project?: string,
): Promise<Result<JiraUser[]>> {
  const key = encodeURIComponent(projectOf(s, project));
  const q = encodeURIComponent(query);
  const cloud = s.jira.deployment === "cloud";

  const paths = cloud
    ? [`/rest/api/3/user/assignable/search?project=${key}&query=${q}&maxResults=100`]
    : [
      // Jira 8.4+ accepts `query`; older Server/DC only understands `username`,
      // where an empty value returns nothing and "." acts as a wildcard.
      `/rest/api/2/user/assignable/search?project=${key}&query=${q}&maxResults=100`,
      `/rest/api/2/user/assignable/search?project=${key}&username=${q || "."}&maxResults=100`,
      `/rest/api/2/user/assignable/search?project=${key}&maxResults=100`,
    ];

  let lastError = "No assignable users returned.";
  for (const path of paths) {
    const r = await api<Array<{
      name?: string; accountId?: string; displayName?: string;
      emailAddress?: string; active?: boolean; avatarUrls?: Record<string, string>;
    }>>(s, path);
    if (!r.ok) { lastError = r.error; continue; }
    if (!Array.isArray(r.data)) continue;
    const users = r.data
      // `active` here is Jira's account-enabled flag, not our ranking flag.
      .filter((u) => u.active !== false)
      .map((u) => ({
        id: (cloud ? u.accountId : u.name) ?? "",
        displayName: u.displayName || u.name || u.accountId || "",
        email: u.emailAddress,
        avatar: u.avatarUrls?.["24x24"],
      }))
      .filter((u) => u.id);
    if (users.length) return ok(users);
  }
  return err(lastError);
}

/**
 * Who already holds issues in this project, most-loaded first.
 *
 * The person to assign a new bug to is almost always someone already working in
 * the project, so they belong at the top of the list rather than buried in an
 * alphabetical roster of everyone with permission.
 */
export async function recentAssignees(
  s: AppSettings, project?: string,
): Promise<Result<Map<string, { user: JiraUser; count: number }>>> {
  const key = projectOf(s, project);
  const cloud = s.jira.deployment === "cloud";
  const jql = encodeURIComponent(
    `project = "${key}" AND assignee IS NOT EMPTY ORDER BY updated DESC`,
  );
  const r = await api<{
    issues?: Array<{ fields?: { assignee?: {
      name?: string; accountId?: string; displayName?: string;
      emailAddress?: string; avatarUrls?: Record<string, string>;
    } } }>;
  }>(s, `/rest/api/2/search?jql=${jql}&fields=assignee&maxResults=100`);
  if (!r.ok) return r;

  const seen = new Map<string, { user: JiraUser; count: number }>();
  for (const issue of r.data.issues ?? []) {
    const a = issue.fields?.assignee;
    if (!a) continue;
    const id = (cloud ? a.accountId : a.name) ?? "";
    if (!id) continue;
    const entry = seen.get(id);
    if (entry) { entry.count += 1; continue; }
    seen.set(id, {
      count: 1,
      user: {
        id,
        displayName: a.displayName || id,
        email: a.emailAddress,
        avatar: a.avatarUrls?.["24x24"],
      },
    });
  }
  return ok(seen);
}

/**
 * The assignee list as the picker shows it: people already carrying issues in
 * this project first (busiest first), then everyone else alphabetically.
 *
 * Either source alone is still useful, so a failure in one does not empty the
 * picker — the common case of a locked-down search permission would otherwise
 * leave the tester with no way to assign at all.
 */
export async function assigneeOptions(
  s: AppSettings, query = "", project?: string,
): Promise<Result<JiraUser[]>> {
  const [assignable, recent] = await Promise.all([
    listAssignees(s, query, project),
    recentAssignees(s, project),
  ]);

  const ranked = recent.ok ? recent.data : new Map<string, { user: JiraUser; count: number }>();

  if (!assignable.ok) {
    if (!ranked.size) return assignable;   // both failed — surface the real error
    const only = [...ranked.values()]
      .sort((a, b) => b.count - a.count)
      .map(({ user, count }) => ({ ...user, issueCount: count, active: true }));
    return ok(filterUsers(only, query));
  }

  return ok(filterUsers(rankAssignees(assignable.data, ranked), query));
}

/**
 * Order the picker: people already carrying issues in this project first,
 * busiest first, then everyone else alphabetically.
 *
 * Pure, so the ordering — the part with actual product judgement in it — is
 * testable without a Jira.
 */
export function rankAssignees(
  assignable: JiraUser[],
  ranked: Map<string, { user: JiraUser; count: number }>,
): JiraUser[] {
  const active: JiraUser[] = [];
  const others: JiraUser[] = [];
  for (const u of assignable) {
    const hit = ranked.get(u.id);
    if (hit) active.push({ ...u, issueCount: hit.count, active: true });
    else others.push({ ...u, active: false });
  }
  // Someone holding issues here but missing from the assignable roster (a
  // permission quirk, or a since-deactivated account) is still worth offering —
  // dropping them would hide the most obvious assignee.
  for (const [id, { user, count }] of ranked) {
    if (!assignable.some((u) => u.id === id)) {
      active.push({ ...user, issueCount: count, active: true });
    }
  }

  active.sort((a, b) => (b.issueCount ?? 0) - (a.issueCount ?? 0)
    || a.displayName.localeCompare(b.displayName));
  others.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return [...active, ...others];
}

/** Client-side narrowing, so typing still filters the list when the server-side
 *  query was ignored by an older Jira. */
export function filterUsers(users: JiraUser[], query: string): JiraUser[] {
  const q = query.trim().toLowerCase();
  if (!q) return users;
  return users.filter((u) =>
    u.displayName.toLowerCase().includes(q)
    || (u.email ?? "").toLowerCase().includes(q)
    || u.id.toLowerCase().includes(q));
}

export async function listBoards(s: AppSettings, project?: string): Promise<Result<JiraBoard[]>> {
  const r = await api<{ values: Array<{ id: number; name: string }> }>(
    s,
    `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectOf(s, project))}&maxResults=50`,
  );
  if (!r.ok) return r;
  return ok(r.data.values.map((b) => ({ id: b.id, name: b.name })));
}

/** The board's active sprint, if any. Returns null (not an error) when the board
 *  is Kanban or has no sprint running — "no sprint" is a normal state. */
export async function activeSprint(s: AppSettings, boardId: number): Promise<Result<JiraSprint | null>> {
  const r = await api<{ values: Array<{ id: number; name: string; state: string }> }>(
    s,
    `/rest/agile/1.0/board/${boardId}/sprint?state=active`,
  );
  if (!r.ok) return r;
  const sp = r.data.values[0];
  return ok(sp ? { id: sp.id, name: sp.name, state: sp.state } : null);
}

// ---------------------------------------------------------------------------
// The tester's queue — issues in the current sprint at a given status
// ---------------------------------------------------------------------------

interface RawUser {
  name?: string; accountId?: string; displayName?: string;
  emailAddress?: string; avatarUrls?: Record<string, string>;
}

function toUser(cloud: boolean, raw: RawUser | null | undefined): JiraUser | undefined {
  if (!raw) return undefined;
  const id = (cloud ? raw.accountId : raw.name) ?? "";
  return {
    id,
    displayName: raw.displayName || raw.name || raw.accountId || "Unknown",
    email: raw.emailAddress,
    avatar: raw.avatarUrls?.["24x24"],
  };
}

/**
 * A JQL string literal.
 *
 * Status names are chosen by whoever configured the project, not by us — "Ready
 * for QA", `Won't Fix`, and names containing a double quote are all legal. An
 * unescaped one either breaks the query or, with a crafted name, changes what it
 * matches, so every interpolated value goes through here.
 */
export function jqlLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The queue query.
 *
 * Pure, because this is the one place where getting the syntax subtly wrong
 * returns a *plausible but wrong* list rather than an error — the failure mode a
 * tester would never notice.
 */
export function queueJql(project: string, statuses: string[], sprintOnly: boolean): string {
  const clauses = [`project = ${jqlLiteral(project)}`];
  // Jira Software only. Callers retry without it when the instance has no
  // sprints, so a Kanban project still gets a queue instead of an error.
  if (sprintOnly) clauses.push("sprint in openSprints()");
  const picked = statuses.map((s) => s.trim()).filter(Boolean);
  if (picked.length === 1) clauses.push(`status = ${jqlLiteral(picked[0])}`);
  else if (picked.length > 1) clauses.push(`status in (${picked.map(jqlLiteral).join(", ")})`);
  return `${clauses.join(" AND ")} ORDER BY updated DESC`;
}

/** True when a search failed *because* the instance has no sprint field, rather
 *  than for a real reason — the signal to retry unscoped. */
export function isNoSprintError(error: string): boolean {
  return /sprint/i.test(error)
    && /does not exist|unknown|not searchable|no field|cannot be found/i.test(error);
}

/** Flatten `/project/{key}/statuses` — it returns statuses grouped per issue
 *  type, so the same status appears once per type. The tester wants one list. */
export function flattenStatuses(
  groups: Array<{ statuses?: Array<{ id?: string; name?: string; statusCategory?: { key?: string } }> }>,
): JiraStatus[] {
  const seen = new Map<string, JiraStatus>();
  for (const g of groups ?? []) {
    for (const s of g.statuses ?? []) {
      if (!s?.name || seen.has(s.name)) continue;
      seen.set(s.name, { id: s.id ?? s.name, name: s.name, category: s.statusCategory?.key });
    }
  }
  return [...seen.values()];
}

/** Every status this project's workflows use, for the queue's filter. */
export async function listStatuses(s: AppSettings, project?: string): Promise<Result<JiraStatus[]>> {
  const key = encodeURIComponent(projectOf(s, project));
  if (!key) return err("No Jira project selected.");
  const r = await api<Array<{ statuses?: Array<{ id?: string; name?: string; statusCategory?: { key?: string } }> }>>(
    s, `/rest/api/2/project/${key}/statuses`,
  );
  if (!r.ok) return r;
  return ok(flattenStatuses(r.data));
}

interface RawIssue {
  key?: string;
  fields?: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    priority?: { name?: string };
    assignee?: RawUser;
    reporter?: RawUser;
    updated?: string;
  };
}

function toIssue(s: AppSettings, raw: RawIssue): JiraIssue {
  const cloud = s.jira.deployment === "cloud";
  const f = raw.fields ?? {};
  return {
    key: raw.key ?? "",
    summary: f.summary ?? "",
    status: f.status?.name ?? "",
    statusCategory: f.status?.statusCategory?.key,
    issueType: f.issuetype?.name,
    priority: f.priority?.name,
    assignee: toUser(cloud, f.assignee),
    reporter: toUser(cloud, f.reporter),
    updated: f.updated,
    url: `${base(s)}/browse/${raw.key ?? ""}`,
  };
}

export interface QueueOpts {
  project?: string;
  /** Empty means every status — "show me the whole sprint". */
  statuses: string[];
  /** Limit to the open sprint. Silently relaxed when the instance has none. */
  sprintOnly: boolean;
}

export interface Queue {
  issues: JiraIssue[];
  /** False when the sprint filter was asked for but had to be dropped, so the
   *  sidebar can say "whole project" instead of quietly lying about scope. */
  sprintScoped: boolean;
}

export async function listQueue(s: AppSettings, opts: QueueOpts): Promise<Result<Queue>> {
  const project = projectOf(s, opts.project);
  if (!project) return err("No Jira project selected.");

  const fields = "summary,status,issuetype,priority,assignee,reporter,updated";
  const run = async (sprintOnly: boolean) => await api<{ issues?: RawIssue[] }>(
    s,
    `/rest/api/2/search?jql=${encodeURIComponent(queueJql(project, opts.statuses, sprintOnly))}`
    + `&fields=${fields}&maxResults=100`,
  );

  let sprintScoped = opts.sprintOnly;
  let r = await run(opts.sprintOnly);
  // A Kanban project, or a Jira without Jira Software, has no sprint field at
  // all. That is not the tester's mistake, so fall back to the whole project.
  if (!r.ok && opts.sprintOnly && isNoSprintError(r.error)) {
    sprintScoped = false;
    r = await run(false);
  }
  if (!r.ok) return r;
  return ok({ issues: (r.data.issues ?? []).map((i) => toIssue(s, i)), sprintScoped });
}

// ---------------------------------------------------------------------------
// One issue: detail, comments, attachments, transitions
// ---------------------------------------------------------------------------

export async function getIssue(s: AppSettings, issueKey: string): Promise<Result<JiraIssueDetail>> {
  const r = await api<RawIssue & {
    fields?: {
      description?: string;
      labels?: string[];
      created?: string;
      comment?: { comments?: Array<{ id?: string; author?: RawUser; body?: string; created?: string }> };
      attachment?: Array<{
        id?: string; filename?: string; mimeType?: string; size?: number;
        created?: string; content?: string; thumbnail?: string;
      }>;
    };
  }>(
    s,
    // v2 returns `description` as wiki-markup text. v3 would return ADF, which
    // is a document tree we would have to render — another reason to stay on v2.
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}`
    + "?fields=summary,status,issuetype,priority,assignee,reporter,updated,description,labels,created,comment,attachment",
  );
  if (!r.ok) return r;

  const f = r.data.fields ?? {};
  return ok({
    ...toIssue(s, r.data),
    key: r.data.key || issueKey,
    url: `${base(s)}/browse/${r.data.key || issueKey}`,
    description: typeof f.description === "string" ? f.description : "",
    labels: Array.isArray(f.labels) ? f.labels : [],
    created: f.created,
    comments: (f.comment?.comments ?? []).map((c): JiraComment => ({
      id: c.id ?? "",
      author: c.author?.displayName || c.author?.name || "Unknown",
      authorAvatar: c.author?.avatarUrls?.["24x24"],
      body: typeof c.body === "string" ? c.body : "",
      created: c.created ?? "",
    })),
    attachments: (f.attachment ?? []).map((a): JiraAttachment => ({
      id: a.id ?? "",
      filename: a.filename ?? "attachment",
      mimeType: a.mimeType ?? "",
      size: a.size ?? 0,
      created: a.created,
      content: a.content ?? "",
      thumbnail: a.thumbnail,
    })),
  });
}

/**
 * Moves the workflow allows from where this issue is now.
 *
 * Jira models a status change as a *transition*, and which ones exist depends on
 * the issue's current status and the project's workflow — there is no "set the
 * status to X". So the sidebar offers exactly what the workflow permits.
 */
export async function listTransitions(s: AppSettings, issueKey: string): Promise<Result<JiraTransition[]>> {
  const r = await api<{ transitions?: Array<{
    id?: string; name?: string; to?: { name?: string; statusCategory?: { key?: string } };
  }> }>(s, `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`);
  if (!r.ok) return r;
  return ok((r.data.transitions ?? [])
    .filter((t) => t.id)
    .map((t) => ({
      id: t.id ?? "",
      name: t.name ?? "",
      to: t.to?.name ?? t.name ?? "",
      toCategory: t.to?.statusCategory?.key,
    })));
}

export async function transitionIssue(
  s: AppSettings, issueKey: string, transitionId: string,
): Promise<Result<void>> {
  return api<void>(s, `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
}

/** Post a comment. The tester writes plain prose; v2 stores wiki markup, and
 *  plain prose is valid wiki markup, so it round-trips unchanged. */
export async function addComment(
  s: AppSettings, issueKey: string, body: string,
): Promise<Result<JiraComment>> {
  const text = body.trim();
  if (!text) return err("Comment is empty.");
  const r = await api<{ id?: string; author?: RawUser; body?: string; created?: string }>(
    s, `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`,
    { method: "POST", body: JSON.stringify({ body: markdownToJira(text) }) },
  );
  if (!r.ok) return r;
  return ok({
    id: r.data.id ?? "",
    author: r.data.author?.displayName || r.data.author?.name || "You",
    authorAvatar: r.data.author?.avatarUrls?.["24x24"],
    body: typeof r.data.body === "string" ? r.data.body : text,
    created: r.data.created ?? new Date().toISOString(),
  });
}

/**
 * Fetch an attachment as a data: URL.
 *
 * Attachment URLs need the same credentials as the API, which live only in the
 * main process — the renderer cannot load one into an <img> directly. Guarded by
 * size and by origin: this must never become a way for a page under test to make
 * us fetch an arbitrary URL with a Jira token attached.
 */
export async function fetchAttachment(
  s: AppSettings, url: string, maxBytes = 12 * 1024 * 1024,
): Promise<Result<string>> {
  if (!url.startsWith(`${base(s)}/`)) return err("Attachment is not on this Jira server.");
  try {
    const res = await fetch(url, { headers: { Authorization: authHeader(s) } });
    if (!res.ok) return err(await explain(res));
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return err("Attachment is too large to preview.");
    const type = res.headers.get("content-type") || "application/octet-stream";
    return ok(`data:${type};base64,${buf.toString("base64")}`);
  } catch (e) {
    return err(`Cannot load attachment — ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateOpts {
  /** Project to file into. Falls back to the saved default when absent. */
  project?: string;
  summary: string;
  /** The exact Markdown the tester previewed. Cloud's v3 API wants ADF, but v2
   *  accepts wiki markup on both deployments and renders it — so we convert to
   *  wiki markup, post to v2 everywhere, and keep one code path. */
  markdown: string;
  labels: string[];
  /** Assignee identifier (DC `name` / Cloud `accountId`); empty = unassigned. */
  assignee?: string;
  /** PNG attachments as data: URLs, named for the ticket. */
  attachments?: Array<{ name: string; dataUrl: string }>;
}

export async function createIssue(s: AppSettings, opts: CreateOpts): Promise<Result<CreatedIssue>> {
  const project = projectOf(s, opts.project);
  if (!project) return err("No Jira project selected.");
  const fields: Record<string, unknown> = {
    project: { key: project },
    summary: opts.summary.slice(0, 250),
    description: markdownToJira(opts.markdown),
    issuetype: { name: s.jira.issueType },
    labels: [...new Set([...s.jira.labels, ...opts.labels])].filter(Boolean).map((l) => l.replace(/\s+/g, "-")),
  };
  if (opts.assignee) {
    fields.assignee = s.jira.deployment === "cloud"
      ? { accountId: opts.assignee }
      : { name: opts.assignee };
  }

  let created = await api<{ key: string }>(s, "/rest/api/2/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });

  // Priority is the most common "field is not on the screen" rejection, and
  // labels the second. Neither is worth failing the whole submit over, so on a
  // field-level rejection retry once with only the fields Jira always accepts.
  if (!created.ok && /cannot be set|not on the appropriate screen|unknown field/i.test(created.error)) {
    const minimal = {
      project: fields.project, summary: fields.summary,
      description: fields.description, issuetype: fields.issuetype,
      ...(fields.assignee ? { assignee: fields.assignee } : {}),
    };
    created = await api<{ key: string }>(s, "/rest/api/2/issue", {
      method: "POST",
      body: JSON.stringify({ fields: minimal }),
    });
  }
  if (!created.ok) return created;

  const key = created.data.key;
  const url = `${base(s)}/browse/${key}`;

  // Attachments and sprint are best-effort: the issue exists, and losing a
  // screenshot must not present to the user as "filing failed".
  for (const att of opts.attachments ?? []) {
    await attach(s, key, att.name, att.dataUrl).catch(() => {});
  }
  if (s.jira.autoAddToSprint) await addToActiveSprint(s, key, project).catch(() => {});

  return ok({ key, url });
}

/** Multipart upload of one PNG. Jira insists on the `file` field name and the
 *  no-check XSRF header (already set globally in `api`). */
export async function attach(
  s: AppSettings, issueKey: string, name: string, dataUrl: string,
): Promise<Result<void>> {
  const b64 = dataUrl.replace(/^data:[^,]*,/, "");
  const bytes = Buffer.from(b64, "base64");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), name);
  return api<void>(s, `/rest/api/2/issue/${issueKey}/attachments`, { method: "POST", body: form });
}

/** Move a freshly created issue into the board's active sprint. */
export async function addToActiveSprint(
  s: AppSettings, issueKey: string, project?: string,
): Promise<Result<string | null>> {
  // A board configured for the default project is meaningless for another one,
  // so an explicit project always re-detects rather than reusing the setting.
  let boardId = project && project !== s.jira.projectKey ? 0 : Number(s.jira.boardId) || 0;
  if (!boardId) {
    const boards = await listBoards(s, project);
    if (!boards.ok) return boards;
    if (!boards.data.length) return ok(null);
    boardId = boards.data[0].id;
  }
  const sprint = await activeSprint(s, boardId);
  if (!sprint.ok) return sprint;
  if (!sprint.data) return ok(null);
  const moved = await api<void>(s, `/rest/agile/1.0/sprint/${sprint.data.id}/issue`, {
    method: "POST",
    body: JSON.stringify({ issues: [issueKey] }),
  });
  if (!moved.ok) return moved;
  return ok(sprint.data.name);
}
