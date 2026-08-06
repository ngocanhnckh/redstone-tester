// Retesting an issue: the other half of the QA cycle.
//
// Filing a bug is only the first visit. The second one — "the dev says it's
// fixed, check it" — is the one that used to mean five tabs: the ticket, the
// steps, the URL, the device it was found on, and somewhere to write the verdict.
// The ticket already holds all of that, so this puts it beside the page instead:
// what to do, what should happen, and the two buttons that end it.
//
// The verdict is composed here rather than in the composer because the common
// case is a pass, and a pass has no evidence to compose. When it fails and the
// tester highlights something, the composer takes over (see `Composer.tsx`),
// which is where the AI review and the full write-up already live.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useStore } from "./store.js";
import { Icon } from "./Icons.js";
import { describeDevice, deviceById } from "./devices.js";
import { retestMarkdown, retestShotName } from "../../shared/ticketFormat.js";
import { suggestTransition } from "../../shared/retest.js";
import type { Verdict } from "../../shared/retest.js";
import type { JiraTransition } from "../../shared/types.js";

export default function RetestBar(): JSX.Element | null {
  const {
    retest, retestOpen, annotations, steps, consoleErrors, settings,
    deviceId, orientation, viewport,
    openRetest, toggleRetestStep, endRetest, setMode, openTab, setOpenIssue, setQueue,
  } = useStore();

  const [transitions, setTransitions] = useState<JiraTransition[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [notes, setNotes] = useState("");
  const [move, setMove] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const key = retest?.key ?? "";

  // Which moves the workflow permits depends on where the issue is now, so this
  // is per-issue rather than per-project. A failure here costs only the picker:
  // a tester without transition rights can still record the verdict.
  useEffect(() => {
    if (!key) { setTransitions([]); return; }
    let cancelled = false;
    void window.tester.jira.transitions(key).then((r) => {
      if (!cancelled) setTransitions(r.ok ? r.data : []);
    });
    return () => { cancelled = true; };
  }, [key]);

  const shots = useMemo(
    () => annotations.filter((a) => a.shot).map((a) => ({ name: retestShotName(a), dataUrl: a.shot as string })),
    [annotations],
  );

  const begin = useCallback((v: Verdict) => {
    setVerdict(v);
    setError("");
    setMove(suggestTransition(v, transitions));
  }, [transitions]);

  // Outlives the session it describes: posting the verdict ends the retest, and
  // the tester still has to be told it landed — and told what did not, when the
  // status move or an upload failed alongside a comment that succeeded.
  if (done) {
    return (
      <div className="glass-surface rise mx-3 mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-[11.5px]">
        <Icon name="check" size={13} style={{ color: "rgb(var(--accent))" }} />
        <span className="soft min-w-0 flex-1 break-words">Retest recorded — {done}</span>
        <button className="btn btn--ghost !px-2 !py-1 !text-[11px]" onClick={() => setDone("")}>
          Dismiss
        </button>
      </div>
    );
  }

  if (!retest) return null;

  const { plan } = retest;
  const walked = retest.done.filter(Boolean).length;

  const post = async (): Promise<void> => {
    if (!verdict) return;
    setBusy(true);
    setError("");

    // A recorded run beats the ticket's steps: it is what actually happened this
    // time, and a retest of a flow that has since changed should say so.
    const followed = steps.length ? steps.map((s) => s.text) : plan.steps;
    const attachments = verdict === "failed" ? shots : [];
    const lang = settings.llm.ticketLang;

    const markdown = retestMarkdown({
      verdict,
      url: useStore.getState().url || plan.url,
      device: describeDevice(deviceById(deviceId), orientation, viewport),
      steps: followed,
      notes,
      annotations: verdict === "failed" ? annotations : [],
      attachmentNames: attachments.map((a) => a.name),
      consoleErrors,
    }, {
      lang,
      headings: settings.llm.headings?.[lang.trim().toLowerCase()],
    });

    const r = await window.tester.jira.retest({
      issueKey: retest.key,
      markdown,
      attachments,
      transitionId: move || undefined,
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }

    // The verdict landed. Anything else that did not is worth saying, but not
    // worth presenting as a failure — the tester's work is recorded either way.
    const warnings: string[] = [];
    if (r.data.moveError) warnings.push(`status not moved — ${r.data.moveError}`);
    if (r.data.failedAttachments.length) {
      warnings.push(`${r.data.failedAttachments.length} screenshot(s) did not upload`);
    }
    setDone(`${retest.key}: ${verdict === "passed" ? "passed" : "still broken"}${
      warnings.length ? ` (${warnings.join("; ")})` : ""}`);
    setVerdict(null);
    setNotes("");
    endRetest();
  };

  return (
    <div className="glass-surface rise mx-3 mb-2 rounded-xl">
      {/* strip */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11.5px]">
        <span className="chip chip--live !py-0.5">
          <Icon name="retest" size={11} /> Retesting
        </span>
        <button
          className="mono shrink-0 text-[11px]"
          style={{ color: "rgb(var(--primary-soft))" }}
          onClick={() => { setQueue({ open: true }); setOpenIssue(retest.key); }}
          title="Show this issue in the queue"
        >
          {retest.key}
        </button>
        <span className="soft min-w-0 flex-1 truncate">{retest.summary}</span>

        {plan.steps.length > 0 && (
          <button className={`chip !py-0.5 ${walked === plan.steps.length ? "chip--live" : ""}`}
            onClick={() => openRetest(!retestOpen)}
            title="The steps this ticket says to follow">
            <Icon name="steps" size={11} className="opacity-70" />
            {walked}/{plan.steps.length} steps
            <Icon name={retestOpen ? "chevUp" : "chevDown"} size={10} className="opacity-60" />
          </button>
        )}

        <button className="btn !py-1 !text-[11px]" disabled={busy}
          onClick={() => begin("passed")} title="It no longer reproduces">
          <Icon name="check" size={12} /> Passes
        </button>
        <button className="btn btn--clay !py-1 !text-[11px]" disabled={busy}
          onClick={() => begin("failed")} title="It still reproduces">
          <Icon name="alert" size={12} /> Still broken
        </button>
        <button className="btn btn--icon btn--ghost" onClick={endRetest} title="Stop retesting">
          <Icon name="close" size={12} />
        </button>
      </div>

      {/* what the ticket said */}
      {retestOpen && (
        <div className="border-t px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
          {!plan.url && plan.steps.length === 0 && (
            <div className="faint text-[11.5px] leading-relaxed">
              This ticket names no URL and no steps, so there is nothing to load. Drive to the
              page yourself, then record the verdict.
            </div>
          )}

          {(plan.expected || plan.current) && (
            <div className="mb-2.5 grid gap-2 sm:grid-cols-2">
              {plan.expected && <Quote label="Should happen" text={plan.expected} />}
              {plan.current && <Quote label="Was happening" text={plan.current} />}
            </div>
          )}

          {plan.steps.length > 0 && (
            <ol>
              {plan.steps.map((s, i) => {
                const ticked = retest.done[i];
                return (
                  <li key={i}>
                    <button
                      className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left"
                      onClick={() => toggleRetestStep(i)}
                    >
                      <Icon name={ticked ? "boxChecked" : "box"} size={13}
                        className="mt-0.5 shrink-0"
                        style={ticked ? { color: "rgb(var(--accent))" } : { opacity: .4 }} />
                      <span className="mono mt-0.5 w-4 shrink-0 text-right text-[10px] faint">{i + 1}</span>
                      <span className={`min-w-0 flex-1 break-words text-[12px] ${ticked ? "faint line-through" : "soft"}`}>
                        {s}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {plan.url && (
              <button className="btn btn--ghost !px-2 !py-1 !text-[11px]" onClick={() => openTab(plan.url)}>
                <Icon name="globe" size={11} /> Reopen the page
              </button>
            )}
            <button className="btn btn--ghost !px-2 !py-1 !text-[11px]" onClick={() => setMode("element")}>
              <Icon name="target" size={11} /> Highlight what is still wrong
            </button>
            {plan.device && (
              <span className="chip mono !py-0.5 !text-[10px]" title="The device this was found on">
                <Icon name="frame" size={10} className="opacity-60" /> {plan.device}
              </span>
            )}
          </div>
        </div>
      )}

      {/* verdict */}
      {verdict && (
        <div className="border-t px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
          <div className="mb-2 flex items-center gap-2 text-[12px]">
            <Icon name={verdict === "passed" ? "check" : "alert"} size={13}
              style={{ color: verdict === "passed" ? "rgb(var(--accent))" : "rgb(var(--primary-soft))" }} />
            <span className="font-medium">
              {verdict === "passed" ? "Passes — no longer reproducible" : "Still broken"}
            </span>
            <span className="flex-1" />
            {verdict === "failed" && shots.length > 0 && (
              <span className="chip !py-0.5 !text-[10px]">
                <Icon name="paperclip" size={10} /> {shots.length} screenshot{shots.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <textarea
            className="field !text-[12px]" rows={2} value={notes} autoFocus
            onChange={(e) => setNotes(e.target.value)}
            placeholder={verdict === "passed"
              ? "Anything worth noting? (optional)"
              : "What still happens, and where it differs from the report"}
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {transitions.length > 0 ? (
              <select className="field !w-auto !py-1 !text-[11.5px]" value={move}
                onChange={(e) => setMove(e.target.value)}>
                <option value="">Leave the status alone</option>
                {transitions.map((t) => (
                  <option key={t.id} value={t.id}>Move to {t.to}</option>
                ))}
              </select>
            ) : (
              <span className="faint text-[10.5px]">
                No status moves available from here — the comment still lands.
              </span>
            )}
            <span className="flex-1" />
            <button className="btn btn--ghost !py-1 !text-[11px]" disabled={busy}
              onClick={() => setVerdict(null)}>
              Cancel
            </button>
            <button className="btn btn--clay !py-1 !text-[11px]" disabled={busy} onClick={() => void post()}>
              {busy
                ? <><span className="spin"><Icon name="reload" size={12} /></span> Posting…</>
                : <><Icon name="send" size={12} /> Comment on {retest.key}</>}
            </button>
          </div>

          {error && (
            <div className="chip chip--warn mt-2 w-full !justify-start !py-1.5">
              <Icon name="alert" size={12} />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Quote({ label, text }: { label: string; text: string }): JSX.Element {
  return (
    <div className="glass-inset rounded-lg px-2.5 py-2">
      <div className="label !mb-1">{label}</div>
      <div className="soft whitespace-pre-wrap text-[11.5px] leading-relaxed">{text}</div>
    </div>
  );
}
