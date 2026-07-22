// The ticket composer. Opens over the browser once defects are highlighted, and
// is the only place a ticket is edited — the same Markdown it previews is what
// gets filed to Jira or copied to the clipboard.

import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useStore } from "./store.js";
import { Icon } from "./Icons.js";
import AiReview from "./AiReview.js";
import AssigneePicker from "./AssigneePicker.js";
import { shotName, ticketMarkdown } from "../../shared/ticketFormat.js";
import type { Severity, Ticket } from "../../shared/types.js";

const SEVERITIES: Severity[] = ["Blocker", "Critical", "Major", "Minor", "Trivial"];

type Status =
  | { kind: "idle" }
  | { kind: "busy"; text: string }
  | { kind: "ok"; text: string; url?: string }
  | { kind: "error"; text: string };

export default function Composer(): JSX.Element | null {
  const { capture, ticket, settings, project, setTicket, closeComposer, openSettings } = useStore();

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [preview, setPreview] = useState(false);
  const [assignee, setAssignee] = useState("");

  // A window files into ITS project, not the saved default — that is the whole
  // point of being able to open a second window on another project.
  const jiraConfigured = Boolean(
    settings.jira.endpoint && settings.jira.token && project &&
    (settings.jira.deployment !== "cloud" || settings.jira.email),
  );

  const attachments = useMemo(() => {
    if (!capture) return [];
    const list = capture.annotations
      .filter((a) => a.shot)
      .map((a) => ({ name: shotName(a), dataUrl: a.shot as string }));
    if (capture.pageShot) list.push({ name: "full-page.png", dataUrl: capture.pageShot });
    return list;
  }, [capture]);

  const markdown = useMemo(() => {
    if (!capture || !ticket) return "";
    const lang = settings.llm.ticketLang;
    return ticketMarkdown(ticket, capture, {
      attachmentNames: attachments.map((a) => a.name),
      tester: settings.tester,
      lang,
      headings: settings.llm.headings?.[lang.trim().toLowerCase()],
    });
  }, [capture, ticket, attachments, settings.tester, settings.llm.ticketLang, settings.llm.headings]);

  if (!capture || !ticket) return null;

  const patch = (p: Partial<Ticket>) => setTicket({ ...ticket, ...p });

  // ── actions ───────────────────────────────────────────────────────────────
  const submit = async () => {
    setStatus({ kind: "busy", text: "Creating issue…" });
    const r = await window.tester.jira.create({
      project,
      summary: ticket.summary,
      markdown,
      labels: ticket.labels,
      assignee: assignee || undefined,
      attachments,
    });
    if (!r.ok) { setStatus({ kind: "error", text: r.error }); return; }
    setStatus({ kind: "ok", text: `Filed ${r.data.key}`, url: r.data.url });
  };

  const copy = async () => {
    await window.tester.clipboard.text(`# ${ticket.summary}\n\n${markdown}`);
    setStatus({ kind: "ok", text: "Ticket copied to clipboard." });
  };

  const copyImage = async () => {
    const shot = capture.pageShot ?? capture.annotations.find((a) => a.shot)?.shot;
    if (!shot) return;
    await window.tester.clipboard.image(shot);
    setStatus({ kind: "ok", text: "Screenshot copied — paste it anywhere." });
  };

  const busy = status.kind === "busy";

  return (
    <div className="absolute inset-0 z-30 flex justify-end" style={{ background: "rgba(10,8,6,.55)" }}>
      <div className="glass-surface rise flex h-full w-[min(620px,92vw)] flex-col rounded-l-2xl"
        style={{ backdropFilter: "blur(34px) saturate(180%)" }}>

        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0">
            <div className="kicker mb-1.5">Bug report</div>
            <div className="display text-[26px]">Compose the ticket</div>
            <div className="faint mono mt-1.5 truncate text-[11px]">{capture.url}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="chip mono !text-[10px]">
                <Icon name="frame" size={10} className="opacity-60" />
                {capture.device ?? `${capture.viewport.w}×${capture.viewport.h}`}
              </span>
              <span className="chip !text-[10px]">
                <Icon name="steps" size={10} className="opacity-60" />
                {capture.steps.length} recorded step{capture.steps.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <button className="btn btn--icon btn--ghost no-drag" onClick={closeComposer} title="Discard">
            <Icon name="close" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* evidence */}
          <div className="mb-5">
            <div className="label">Evidence · {capture.annotations.length} highlighted</div>
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {capture.annotations.map((a) => (
                <div key={a.id} className="glass-inset w-[168px] shrink-0 overflow-hidden rounded-xl">
                  <div className="relative h-[92px] w-full"
                    style={{ background: "#0d0b09" }}>
                    {a.shot
                      ? <img src={a.shot} alt="" className="h-full w-full object-cover" />
                      : <div className="flex h-full items-center justify-center text-[10px] faint">no capture</div>}
                    <span className="absolute left-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                      style={{ background: "rgb(var(--primary))" }}>{a.id}</span>
                  </div>
                  <div className="p-2">
                    <code className="mono block truncate text-[9.5px] opacity-70">
                      {a.selector ?? `${Math.round(a.box.w)}×${Math.round(a.box.h)} region`}
                    </code>
                    <input
                      className="field mt-1.5 !px-2 !py-1 !text-[11px]"
                      placeholder="What's wrong?"
                      value={a.note}
                      onChange={(e) => {
                        useStore.getState().patchAnnotation(a.id, { note: e.target.value });
                        useStore.setState((s) => s.capture
                          ? {
                            capture: {
                              ...s.capture,
                              annotations: s.capture.annotations.map((x) =>
                                x.id === a.id ? { ...x, note: e.target.value } : x),
                            },
                          }
                          : {});
                      }}
                    />
                  </div>
                </div>
              ))}
              {capture.pageShot && (
                <div className="glass-inset w-[168px] shrink-0 overflow-hidden rounded-xl">
                  <img src={capture.pageShot} alt="" className="h-[92px] w-full object-cover object-top" />
                  <div className="p-2 text-[10px] faint">Full page (annotated)</div>
                </div>
              )}
            </div>
          </div>

          <AiReview onError={(m) => setStatus(m ? { kind: "error", text: m } : { kind: "idle" })} />

          {preview ? (
            <pre className="glass-inset mono overflow-x-auto whitespace-pre-wrap rounded-xl p-4 text-[11.5px] leading-relaxed soft">
              {`# ${ticket.summary}\n\n${markdown}`}
            </pre>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="label">Summary</label>
                <input className="field" value={ticket.summary}
                  onChange={(e) => patch({ summary: e.target.value })}
                  placeholder="Component + what fails, in one sentence" />
              </div>

              <div>
                <label className="label">Impact</label>
                <textarea className="field" rows={2} value={ticket.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  placeholder="Who is affected and what can't they do?" />
              </div>

              <div>
                <label className="label">Steps to reproduce · recorded automatically</label>
                <textarea className="field" rows={Math.min(9, Math.max(3, ticket.stepsToReproduce.length))}
                  value={ticket.stepsToReproduce.join("\n")}
                  onChange={(e) => patch({ stepsToReproduce: e.target.value.split("\n") })}
                  placeholder="One step per line" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Expected behaviour</label>
                  <textarea className="field" rows={4} value={ticket.expected}
                    onChange={(e) => patch({ expected: e.target.value })}
                    placeholder="What should happen instead" />
                </div>
                <div>
                  <label className="label">Current behaviour</label>
                  <textarea className="field" rows={4} value={ticket.current}
                    onChange={(e) => patch({ current: e.target.value })}
                    placeholder="What actually happens" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Severity</label>
                  <select className="field" value={ticket.severity}
                    onChange={(e) => patch({ severity: e.target.value as Severity })}>
                    {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {jiraConfigured ? (
                  <AssigneePicker value={assignee} onChange={setAssignee} project={project} />
                ) : <div />}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Labels</label>
                  <input className="field" value={ticket.labels.join(", ")}
                    onChange={(e) => patch({
                      labels: e.target.value.split(",").map((l) => l.trim()).filter(Boolean),
                    })}
                    placeholder="comma, separated" />
                </div>
              </div>

              <div>
                <label className="label">Environment notes</label>
                <input className="field" value={ticket.environment}
                  onChange={(e) => patch({ environment: e.target.value })}
                  placeholder="Build, account, feature flag… (URL and viewport are added for you)" />
              </div>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="border-t px-5 py-3.5" style={{ borderColor: "var(--border)" }}>
          {status.kind !== "idle" && (
            <div className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
              style={{
                background: status.kind === "error" ? "rgb(229 77 46 / .14)" : "rgba(255,255,255,.05)",
                border: `1px solid ${status.kind === "error" ? "rgb(var(--primary-soft) / .45)" : "var(--border)"}`,
              }}>
              {status.kind === "busy" && <span className="spin"><Icon name="reload" /></span>}
              {status.kind === "ok" && <Icon name="check" style={{ color: "rgb(var(--accent))" }} />}
              {status.kind === "error" && <Icon name="alert" />}
              <span className="min-w-0 flex-1 break-words soft">{status.text}</span>
              {status.kind === "ok" && status.url && (
                <button className="btn btn--ghost !px-2 !py-1 !text-[11px]"
                  onClick={() => void window.tester.openExternal(status.url as string)}>
                  <Icon name="link" /> Open
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button className="btn btn--ghost" onClick={() => setPreview(!preview)}>
              <Icon name="code" /> {preview ? "Edit" : "Preview"}
            </button>

            <span className="flex-1" />

            <button className="btn" onClick={() => void copy()}>
              <Icon name="copy" /> Copy ticket
            </button>
            {(capture.pageShot || attachments.length > 0) && (
              <button className="btn btn--icon" onClick={() => void copyImage()} title="Copy screenshot">
                <Icon name="crop" />
              </button>
            )}

            {jiraConfigured ? (
              <button className="btn btn--clay" disabled={busy || !ticket.summary.trim()}
                onClick={() => void submit()}>
                <Icon name="send" /> Create in {project}
              </button>
            ) : (
              <button className="btn btn--clay" onClick={() => openSettings(true)}>
                <Icon name="gear" /> Connect Jira
              </button>
            )}
          </div>

          {jiraConfigured && settings.jira.autoAddToSprint && (
            <div className="faint mt-2 text-[10.5px]">
              Will be added to the active sprint{settings.jira.boardId ? ` on board ${settings.jira.boardId}` : ""}.
            </div>
          )}
          {!jiraConfigured && (
            <div className="faint mt-2 text-[10.5px]">
              No Jira connected — copy the ticket instead, or add your endpoint and token in settings.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
