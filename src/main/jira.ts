// Jira REST client covering both self-hosted Data Center/Server and Cloud.
//
// The two deployments diverge in three places and nowhere else that we care about:
//   auth      DC: `Authorization: Bearer <PAT>`   Cloud: Basic base64(email:token)
//   users     DC: identified by `name`            Cloud: by `accountId`
//   agile API DC exposes /rest/agile/1.0 only when Jira Software is installed.
// Everything else is shared, so the deployment flag is threaded through a few
// small helpers rather than forking the whole client.

import {
  AppSettings, CreatedIssue, JiraBoard, JiraProject, JiraSprint, JiraUser, Result,
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
