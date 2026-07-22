// The recorded steps, visible while testing. Without this the tester only sees a
// count and has to trust it — and a step they didn't mean to record (a stray
// click, a wrong turn) silently ends up in the ticket. Every step is removable
// here, before it ever reaches the composer.

import type { JSX } from "react";
import { useStore } from "./store.js";
import { Icon } from "./Icons.js";
import type { Step } from "../../shared/types.js";

const KIND_ICON: Record<Step["kind"], string> = {
  navigate: "globe",
  click: "target",
  input: "steps",
  submit: "send",
  key: "steps",
  resize: "frame",
};

export default function StepsPanel(): JSX.Element {
  const { steps, recording, removeStep, clearSteps, openSteps } = useStore();

  return (
    <div className="glass-surface rise mx-3 mb-2 max-h-[240px] overflow-y-auto rounded-xl">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--app-panel) 88%, transparent)" }}>
        <span className="kicker">Steps to reproduce</span>
        {recording && (
          <span className="chip chip--live !py-0.5 !text-[10px]">
            <span className="dot pulse" /> recording
          </span>
        )}
        <span className="flex-1" />
        {steps.length > 0 && (
          <button className="btn btn--ghost !px-2 !py-1 !text-[11px]" onClick={clearSteps}>
            <Icon name="trash" size={12} /> Clear
          </button>
        )}
        <button className="btn btn--icon btn--ghost" onClick={() => openSteps(false)} title="Hide">
          <Icon name="chevUp" size={12} />
        </button>
      </div>

      {steps.length === 0 ? (
        <div className="faint px-3 py-4 text-[12px] leading-relaxed">
          {recording
            ? "Recording. Use the page as a tester would — every click, entry and navigation lands here."
            : <>Nothing recorded yet. Press <b className="soft">Record steps</b>, then walk through what
              goes wrong. Highlighting a defect is never recorded as a step.</>}
        </div>
      ) : (
        <ol className="px-3 py-2">
          {steps.map((s, i) => (
            <li key={`${s.t}-${i}`} className="group flex items-start gap-2.5 py-1.5">
              <span className="mono mt-0.5 w-5 shrink-0 text-right text-[10px] faint">{i + 1}</span>
              <Icon name={KIND_ICON[s.kind] ?? "steps"} size={12}
                className="mt-0.5 shrink-0 opacity-45" />
              <span className="min-w-0 flex-1 break-words text-[12px] soft">{s.text}</span>
              <button
                className="btn btn--icon btn--ghost !h-5 !w-5 shrink-0 opacity-0 group-hover:opacity-100"
                onClick={() => removeStep(i)}
                title="Remove this step"
              >
                <Icon name="close" size={11} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
