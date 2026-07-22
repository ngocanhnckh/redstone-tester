// The tester's queue: what is sitting at a given status in the current sprint,
// and everything needed to act on it without leaving the app.
//
// The point is to remove the tab-switching that eats a QA session — read the
// ticket, drive the page beside it, move the status, leave a comment. So this is
// a column next to the browser rather than a modal: the page under test stays
// visible and usable the whole time.

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { useStore } from "./store.js";
import { Icon } from "./Icons.js";
import { jiraToPlain } from "../../shared/jiraMarkup.js";
import { fileSize, relTime } from "../../shared/time.js";
import type {
  JiraAttachment, JiraIssue, JiraIssueDetail, JiraStatus, JiraTransition,
} from "../../shared/types.js";

/** Jira's own status categories, mapped onto the palette. `indeterminate` is
 *  Jira's word for "in progress". */
function statusTone(category?: string): { bg: string; fg: string } {
  if (category === "done") return { bg: "rgb(var(--ok) / .16)", fg: "rgb(var(--ok))" };
  if (category === "indeterminate") return { bg: "rgb(var(--primary) / .2)", fg: "rgb(var(--primary-soft))" };
  return { bg: "rgba(255,255,255,.07)", fg: "var(--text-soft)" };
}

export default function Queue(): JSX.Element {
  const { project, queue, openIssue, setQueue, setOpenIssue, openTab } = useStore();

  const [statuses, setStatuses] = useState<JiraStatus[]>([]);
  const [issues, setIssues] = useState<JiraIssue[] | null>(null);
  const [sprintScoped, setSprintScoped] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const load = useCallback(async () => {
    if (!project) return;
    setBusy(true);
    setError("");
    const r = await window.tester.jira.queue({
      project, statuses: queue.statuses, sprintOnly: queue.sprintOnly,
    });
    if (r.ok) {
      setIssues(r.data.issues);
      setSprintScoped(r.data.sprintScoped);
    } else {
      setError(r.error);
      setIssues([]);
    }
    setBusy(false);
  }, [project, queue.statuses, queue.sprintOnly]);

  useEffect(() => { void load(); }, [load]);

  // The status list only changes when the project does.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void window.tester.jira.statuses(project).then((r) => {
      if (!cancelled && r.ok) setStatuses(r.data);
    });
    return () => { cancelled = true; };
  }, [project]);

  const toggleStatus = (name: string) => {
    const next = queue.statuses.includes(name)
      ? queue.statuses.filter((s) => s !== name)
      : [...queue.statuses, name];
    setQueue({ statuses: next });
  };

  const label = queue.statuses.length === 0
    ? "All statuses"
    : queue.statuses.length === 1
      ? queue.statuses[0]
      : `${queue.statuses.length} statuses`;

  return (
    <aside className="glass-surface mb-3 mr-3 flex w-[380px] shrink-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center gap-2 border-b px-3.5 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="min-w-0 flex-1">
          <div className="kicker">Queue</div>
          <div className="display truncate text-[15px]">
            {openIssue || (project ? `${project} · ${queue.sprintOnly && sprintScoped ? "current sprint" : "all open"}` : "No project")}
          </div>
        </div>
        <button className="btn btn--icon btn--ghost" onClick={() => void load()}
          title="Refresh" disabled={busy}>
          <span className={busy ? "spin" : undefined}><Icon name="reload" /></span>
        </button>
        <button className="btn btn--icon btn--ghost" onClick={() => setQueue({ open: false })}
          title="Hide the queue (⌘⇧Q)">
          <Icon name="close" />
        </button>
      </div>

      {!openIssue && (
        <div className="relative flex items-center gap-1.5 border-b px-3.5 py-2"
          style={{ borderColor: "var(--border)" }}>
          <button className="chip min-w-0" onClick={() => setFilterOpen(!filterOpen)}
            title="Which statuses to show">
            <span className="truncate">{label}</span>
            <Icon name={filterOpen ? "chevUp" : "chevDown"} size={10} className="opacity-60" />
          </button>
          <button
            className={`chip ${queue.sprintOnly ? "chip--live" : ""}`}
            onClick={() => setQueue({ sprintOnly: !queue.sprintOnly })}
            title={queue.sprintOnly ? "Showing the open sprint only" : "Showing every open issue in the project"}
          >
            {queue.sprintOnly ? "Sprint" : "Project"}
          </button>
          <span className="flex-1" />
          <span className="faint text-[11px]">{issues ? `${issues.length}` : ""}</span>

          {/* Sprint filter asked for but unavailable — say so rather than show a
              project-wide list labelled as a sprint. */}
          {queue.sprintOnly && !sprintScoped && (
            <span className="chip chip--warn !py-0.5 !text-[10px]" title="This Jira has no open sprint for the project, so the whole project is shown.">
              no sprint
            </span>
          )}

          {filterOpen && (
            <div className="glass-surface rise absolute left-3 top-[calc(100%-2px)] z-30 max-h-[300px] w-[300px] overflow-y-auto rounded-xl p-1.5"
              style={{ backdropFilter: "blur(30px) saturate(180%)" }}>
              {statuses.length === 0 && (
                <div className="faint px-2 py-3 text-[12px]">
                  No statuses read from this project yet.
                </div>
              )}
              {statuses.map((s) => {
                const on = queue.statuses.includes(s.name);
                const tone = statusTone(s.category);
                return (
                  <button key={s.id + s.name}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-white/5"
                    onClick={() => toggleStatus(s.name)}>
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded"
                      style={{
                        border: "1px solid var(--border)",
                        background: on ? "rgb(var(--primary) / .8)" : "transparent",
                      }}>
                      {on && <Icon name="check" size={9} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="mono shrink-0 rounded px-1.5 py-0.5 text-[9.5px]"
                      style={{ background: tone.bg, color: tone.fg }}>
                      {s.category === "indeterminate" ? "in progress" : s.category ?? ""}
                    </span>
                  </button>
                );
              })}
              <div className="flex items-center gap-2 border-t px-2 pb-1 pt-2"
                style={{ borderColor: "var(--border)" }}>
                <button className="btn btn--ghost !px-2 !py-1 !text-[11px]"
                  onClick={() => setQueue({ statuses: [] })}>Clear</button>
                <span className="flex-1" />
                <button className="btn !px-2 !py-1 !text-[11px]" onClick={() => setFilterOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="chip chip--warn m-3 w-[calc(100%-24px)] !justify-start !py-1.5">
            <Icon name="alert" size={12} />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        {openIssue ? (
          <IssueDetail
            issueKey={openIssue}
            onBack={() => setOpenIssue("")}
            onChanged={() => void load()}
            onOpenInBrowser={(url) => openTab(url)}
          />
        ) : (
          <>
            {!issues && !error && (
              <div className="faint flex items-center gap-2 p-4 text-[12px]">
                <span className="spin"><Icon name="reload" size={13} /></span> Loading issues…
              </div>
            )}
            {issues && issues.length === 0 && !error && (
              <div className="faint p-4 text-[12px] leading-relaxed">
                Nothing here. {queue.statuses.length > 0
                  ? <>No issue is at <b className="soft">{queue.statuses.join(", ")}</b>{queue.sprintOnly ? " in the open sprint" : ""}.</>
                  : "The sprint is empty."}
              </div>
            )}
            <div className="p-2">
              {(issues ?? []).map((it) => (
                <IssueRow key={it.key} issue={it} onOpen={() => setOpenIssue(it.key)} />
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function IssueRow({ issue, onOpen }: { issue: JiraIssue; onOpen: () => void }): JSX.Element {
  const tone = statusTone(issue.statusCategory);
  return (
    <button className="glass-inset mb-1.5 flex w-full flex-col gap-1.5 rounded-xl px-3 py-2.5 text-left"
      onClick={onOpen}>
      <div className="flex w-full items-center gap-2">
        <span className="mono shrink-0 text-[10.5px]" style={{ color: "rgb(var(--primary-soft))" }}>
          {issue.key}
        </span>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9.5px]"
          style={{ background: tone.bg, color: tone.fg }}>
          {issue.status}
        </span>
        <span className="flex-1" />
        <span className="faint shrink-0 text-[10px]">{relTime(issue.updated, Date.now())}</span>
      </div>
      <div className="line-clamp-2 w-full text-[12.5px] leading-snug">{issue.summary}</div>
      <div className="flex w-full items-center gap-1.5">
        <Icon name="user" size={10} className="shrink-0 opacity-40" />
        <span className="faint min-w-0 truncate text-[10.5px]">
          {issue.assignee?.displayName ?? "Unassigned"}
        </span>
        {issue.priority && (
          <span className="faint shrink-0 text-[10.5px]">· {issue.priority}</span>
        )}
      </div>
    </button>
  );
}

function IssueDetail({ issueKey, onBack, onChanged, onOpenInBrowser }: {
  issueKey: string;
  onBack: () => void;
  onChanged: () => void;
  onOpenInBrowser: (url: string) => void;
}): JSX.Element {
  const [issue, setIssue] = useState<JiraIssueDetail | null>(null);
  const [transitions, setTransitions] = useState<JiraTransition[]>([]);
  const [error, setError] = useState("");
  const [moving, setMoving] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const [d, t] = await Promise.all([
      window.tester.jira.issue(issueKey),
      window.tester.jira.transitions(issueKey),
    ]);
    if (d.ok) setIssue(d.data); else setError(d.error);
    // No transitions is a legitimate state (a closed issue, or no permission),
    // so a failure here only costs the move menu, never the whole pane.
    setTransitions(t.ok ? t.data : []);
  }, [issueKey]);

  useEffect(() => { setIssue(null); void load(); }, [load]);

  const move = async (t: JiraTransition) => {
    setMoving(t.id);
    setMoveOpen(false);
    const r = await window.tester.jira.transition(issueKey, t.id);
    setMoving("");
    if (!r.ok) { setError(r.error); return; }
    // Re-read rather than assume: a workflow post-function can change the
    // assignee or land the issue somewhere other than the transition's name.
    await load();
    onChanged();
  };

  const comment = async () => {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    const r = await window.tester.jira.comment(issueKey, body);
    setPosting(false);
    if (!r.ok) { setError(r.error); return; }
    setDraft("");
    setIssue((prev) => (prev ? { ...prev, comments: [...prev.comments, r.data] } : prev));
  };

  if (!issue) {
    return (
      <div className="p-3">
        <button className="btn btn--ghost !px-2 !py-1 !text-[11px]" onClick={onBack}>
          <Icon name="back" size={12} /> Queue
        </button>
        {error
          ? <div className="chip chip--warn mt-3 w-full !justify-start"><Icon name="alert" size={12} /> {error}</div>
          : <div className="faint mt-4 flex items-center gap-2 text-[12px]">
            <span className="spin"><Icon name="reload" size={13} /></span> Loading {issueKey}…
          </div>}
      </div>
    );
  }

  const tone = statusTone(issue.statusCategory);
  const body = jiraToPlain(issue.description);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-1.5">
        <button className="btn btn--ghost !px-2 !py-1 !text-[11px]" onClick={onBack}>
          <Icon name="back" size={12} /> Queue
        </button>
        <span className="flex-1" />
        <button className="btn btn--ghost !px-2 !py-1 !text-[11px]"
          onClick={() => onOpenInBrowser(issue.url)}
          title="Open this issue in a tab here">
          <Icon name="globe" size={12} /> Open
        </button>
        <button className="btn btn--icon btn--ghost"
          onClick={() => void window.tester.openExternal(issue.url)}
          title="Open in your normal browser">
          <Icon name="link" size={12} />
        </button>
      </div>

      <div>
        <div className="mono text-[11px]" style={{ color: "rgb(var(--primary-soft))" }}>
          {issue.key}{issue.issueType ? ` · ${issue.issueType}` : ""}
        </div>
        <div className="mt-1 text-[14px] font-medium leading-snug">{issue.summary}</div>
      </div>

      {/* Status + the moves the workflow actually permits from here. */}
      <div className="relative flex items-center gap-1.5">
        <span className="shrink-0 rounded-md px-2 py-1 text-[11px]"
          style={{ background: tone.bg, color: tone.fg }}>
          {issue.status}
        </span>
        {transitions.length > 0 && (
          <button className="btn !px-2 !py-1 !text-[11px]" onClick={() => setMoveOpen(!moveOpen)}
            disabled={Boolean(moving)}>
            <Icon name="arrowRight" size={12} /> Move
            <Icon name={moveOpen ? "chevUp" : "chevDown"} size={10} className="opacity-60" />
          </button>
        )}
        {moving && <span className="spin"><Icon name="reload" size={13} /></span>}

        {moveOpen && (
          <div className="glass-surface rise absolute left-0 top-[calc(100%+4px)] z-30 w-[260px] rounded-xl p-1.5"
            style={{ backdropFilter: "blur(30px) saturate(180%)" }}>
            {transitions.map((t) => {
              const tt = statusTone(t.toCategory);
              return (
                <button key={t.id}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] hover:bg-white/5"
                  onClick={() => void move(t)}>
                  <Icon name="arrowRight" size={11} className="shrink-0 opacity-40" />
                  {/* The status it lands in is what the tester means; the
                      transition's own name is often a verb like "Done". */}
                  <span className="min-w-0 flex-1 truncate">{t.to}</span>
                  {t.name !== t.to && <span className="faint shrink-0 text-[10px]">{t.name}</span>}
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tt.fg }} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="chip chip--warn w-full !justify-start !py-1.5">
          <Icon name="alert" size={12} /> <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      <div className="glass-inset space-y-1.5 rounded-xl px-3 py-2.5 text-[11.5px]">
        <Field label="Assignee" value={issue.assignee?.displayName ?? "Unassigned"} />
        <Field label="Reporter" value={issue.reporter?.displayName ?? "—"} />
        {issue.priority && <Field label="Priority" value={issue.priority} />}
        <Field label="Updated" value={relTime(issue.updated, Date.now()) || "—"} />
        {issue.labels.length > 0 && <Field label="Labels" value={issue.labels.join(", ")} />}
      </div>

      <Section title="Description">
        {body
          ? <div className="whitespace-pre-wrap break-words text-[12px] leading-relaxed soft">{body}</div>
          : <div className="faint text-[12px]">No description.</div>}
      </Section>

      {issue.attachments.length > 0 && (
        <Section title={`Attachments · ${issue.attachments.length}`}>
          <div className="space-y-1.5">
            {issue.attachments.map((a) => <Attachment key={a.id} att={a} />)}
          </div>
        </Section>
      )}

      <Section title={`Comments · ${issue.comments.length}`}>
        {issue.comments.length === 0 && <div className="faint text-[12px]">No comments yet.</div>}
        <div className="space-y-2">
          {issue.comments.map((c) => (
            <div key={c.id} className="glass-inset rounded-lg px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <Icon name="user" size={10} className="opacity-40" />
                <span className="text-[11px] font-medium">{c.author}</span>
                <span className="flex-1" />
                <span className="faint text-[10px]">{relTime(c.created, Date.now())}</span>
              </div>
              <div className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed soft">
                {jiraToPlain(c.body)}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2">
          <textarea
            className="field !text-[12px]"
            rows={3}
            placeholder="Comment on this issue…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void comment(); }
            }}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <span className="faint text-[10px]">⌘↵ to post</span>
            <span className="flex-1" />
            <button className="btn btn--clay !px-2.5 !py-1 !text-[11px]"
              disabled={!draft.trim() || posting} onClick={() => void comment()}>
              {posting ? <span className="spin"><Icon name="reload" size={12} /></span> : <Icon name="comment" size={12} />}
              Comment
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <span className="faint w-[62px] shrink-0">{label}</span>
      <span className="min-w-0 flex-1 break-words soft">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <div className="kicker mb-1.5">{title}</div>
      {children}
    </div>
  );
}

/**
 * One attachment.
 *
 * Images are the whole point of a QA attachment, so they are shown rather than
 * listed — but they are behind Jira's auth, so the bytes come through the main
 * process. Fetched on demand: a ticket with twenty screenshots must not pull
 * twenty files the moment it is opened.
 */
function Attachment({ att }: { att: JiraAttachment }): JSX.Element {
  const [data, setData] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const asked = useRef(false);
  const isImage = att.mimeType.startsWith("image/");

  const show = async () => {
    if (asked.current) return;
    asked.current = true;
    setLoading(true);
    const r = await window.tester.jira.attachment(att.content);
    setLoading(false);
    if (r.ok) setData(r.data); else setError(r.error);
  };

  return (
    <div className="glass-inset overflow-hidden rounded-lg">
      <button className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
        onClick={() => (isImage ? void show() : void window.tester.openExternal(att.content))}>
        <Icon name="paperclip" size={11} className="shrink-0 opacity-45" />
        <span className="min-w-0 flex-1 truncate text-[11.5px]">{att.filename}</span>
        <span className="faint shrink-0 text-[10px]">{fileSize(att.size)}</span>
        {loading && <span className="spin"><Icon name="reload" size={11} /></span>}
        {isImage && !data && !loading && <Icon name="chevDown" size={10} className="opacity-50" />}
      </button>
      {data && <img src={data} alt={att.filename} className="w-full" />}
      {error && (
        <div className="chip chip--warn m-2 !justify-start !py-1 !text-[10px]">
          <Icon name="alert" size={10} /> {error}
        </div>
      )}
    </div>
  );
}
