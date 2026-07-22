// The AI reviewer. It reads the whole draft plus every screenshot, rewrites what
// the evidence supports, says which fields are still too vague for a developer to
// act on, and asks the tester what it genuinely cannot infer. Answers feed back
// into a second pass, so the ticket converges instead of being one-shot rewritten.

import { useState } from "react";
import type { JSX } from "react";
import { useStore } from "./store.js";
import { Icon } from "./Icons.js";
import type { Review } from "../../main/llm.js";

/** Field name → the label the composer shows, so a critique points at something
 *  the tester can actually find on screen. */
const FIELD_LABEL: Record<string, string> = {
  summary: "Summary",
  description: "Impact",
  stepsToReproduce: "Steps to reproduce",
  steps: "Steps to reproduce",
  expected: "Expected behaviour",
  current: "Current behaviour",
  severity: "Severity",
  environment: "Environment notes",
};

export default function AiReview({ onError }: { onError: (msg: string) => void }): JSX.Element {
  const {
    capture, ticket, settings, aiReview, aiAnswers, setTicket, setReview, setAnswer,
    openSettings, setSettings,
  } = useStore();
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);

  const configured = Boolean(settings.llm.endpoint && settings.llm.model);

  const run = async (): Promise<void> => {
    if (!capture || !ticket) return;
    setBusy(true);
    onError("");
    const answers = (aiReview?.questions ?? [])
      .map((q) => ({ question: q.question, answer: (aiAnswers[q.id] ?? "").trim() }))
      .filter((a) => a.answer);

    const r = await window.tester.llm.review(capture, { ticket, hint, answers });
    setBusy(false);
    if (!r.ok) { onError(r.error); return; }

    const rev: Review = r.data;
    setTicket({
      ...ticket,
      ...rev.draft,
      labels: [...new Set([...ticket.labels, ...rev.draft.labels])],
    });
    // Cache the model's section headings for this language so later tickets —
    // and tickets filed without running a review — are not half-English.
    if (rev.headings && Object.keys(rev.headings).length) {
      const key = settings.llm.ticketLang.trim().toLowerCase();
      const next = {
        ...settings,
        llm: {
          ...settings.llm,
          headings: { ...settings.llm.headings, [key]: rev.headings },
        },
      };
      setSettings(await window.tester.settings.set(next));
    }
    setReview(rev);
  };

  const answered = (aiReview?.questions ?? []).filter((q) => (aiAnswers[q.id] ?? "").trim()).length;
  const pending = (aiReview?.questions.length ?? 0) - answered;

  return (
    <div className="glass-inset mb-5 rounded-xl p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon name="sparkle" style={{ color: "rgb(var(--accent))" }} />
        <span className="text-[12.5px] font-medium">AI review</span>
        {aiReview && <Readiness value={aiReview.readiness} />}
        <span className="flex-1" />
        {!configured && (
          <button className="btn btn--ghost !px-2 !py-1 !text-[11px]"
            onClick={() => openSettings(true)}>Configure</button>
        )}
      </div>

      <div className="flex gap-2">
        <input
          className="field flex-1"
          placeholder={aiReview
            ? "Add anything else, then re-run…"
            : "Anything the screenshots don't show? (optional)"}
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy && configured) void run(); }}
        />
        <button className="btn btn--clay" disabled={busy || !configured} onClick={() => void run()}>
          {busy
            ? <><span className="spin"><Icon name="reload" /></span> Reading…</>
            : aiReview
              ? <><Icon name="reload" /> {answered ? `Apply ${answered} answer${answered === 1 ? "" : "s"}` : "Re-review"}</>
              : <><Icon name="sparkle" /> Review &amp; write</>}
        </button>
      </div>

      {/* What is still too vague to act on. */}
      {aiReview && aiReview.critique.length > 0 && (
        <div className="mt-3 space-y-2">
          {aiReview.critique.map((c, i) => (
            <div key={i} className="rounded-lg px-2.5 py-2"
              style={{ background: "rgb(var(--accent) / .08)", border: "1px solid rgb(var(--accent) / .28)" }}>
              <div className="flex items-start gap-2">
                <Icon name="alert" size={12} className="mt-0.5 shrink-0"
                  style={{ color: "rgb(var(--accent))" }} />
                <div className="min-w-0 text-[11.5px] leading-relaxed">
                  <span className="font-medium">{FIELD_LABEL[c.field] ?? c.field}</span>
                  <span className="soft"> — {c.issue}</span>
                  {c.suggestion && <div className="faint mt-1">Try: {c.suggestion}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* What only the tester can answer. */}
      {aiReview && aiReview.questions.length > 0 && (
        <div className="mt-3">
          <div className="label !mb-2 flex items-center gap-1.5">
            <Icon name="question" size={11} />
            {pending > 0 ? `${pending} question${pending === 1 ? "" : "s"} for you` : "All answered"}
          </div>
          <div className="space-y-2.5">
            {aiReview.questions.map((q) => (
              <div key={q.id} className="rounded-lg p-2.5"
                style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--border)" }}>
                <div className="text-[12px] leading-relaxed">{q.question}</div>
                {q.why && <div className="faint mt-0.5 text-[10.5px] leading-relaxed">{q.why}</div>}
                {q.suggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {q.suggestions.map((sug) => (
                      <button
                        key={sug}
                        className={`chip ${aiAnswers[q.id] === sug ? "chip--live" : ""}`}
                        onClick={() => setAnswer(q.id, aiAnswers[q.id] === sug ? "" : sug)}
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  className="field mt-2 !py-1.5 !text-[12px]"
                  placeholder="Your answer…"
                  value={aiAnswers[q.id] ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !busy) void run(); }}
                />
              </div>
            ))}
          </div>
          {pending === 0 && answered > 0 && (
            <div className="faint mt-2 text-[10.5px]">
              Re-run so the answers make it into the ticket.
            </div>
          )}
        </div>
      )}

      {aiReview && aiReview.questions.length === 0 && aiReview.critique.length === 0 && (
        <div className="mt-2.5 flex items-center gap-2 text-[11.5px] soft">
          <Icon name="check" size={12} style={{ color: "rgb(var(--accent))" }} />
          Nothing else to ask — this reads as actionable.
        </div>
      )}
    </div>
  );
}

/** How ready the model thinks the ticket is. A number alone is meaningless, so
 *  it is shown as a bar with a word attached. */
function Readiness({ value }: { value: number }): JSX.Element {
  const label = value >= 80 ? "ready to file" : value >= 55 ? "needs detail" : "too vague";
  const color = value >= 80 ? "rgb(var(--accent))" : "rgb(var(--primary-soft))";
  return (
    <span className="flex items-center gap-1.5" title={`Readiness ${value}/100`}>
      <span className="h-1 w-14 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.12)" }}>
        <span className="block h-full rounded-full"
          style={{ width: `${value}%`, background: color, transition: "width .3s" }} />
      </span>
      <span className="text-[10.5px] faint">{label}</span>
    </span>
  );
}
