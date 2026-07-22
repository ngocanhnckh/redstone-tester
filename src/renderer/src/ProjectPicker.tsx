// Shown when Jira is connected but this window has not been pointed at a project
// yet. Filing into the wrong project is expensive to undo, so the choice is made
// deliberately, once, before any testing — not silently inherited from settings.

import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useStore } from "./store.js";
import { Icon } from "./Icons.js";
import type { JiraProject } from "../../shared/types.js";

export default function ProjectPicker(): JSX.Element | null {
  const { projectPickerOpen, project, settings, setProject, openProjectPicker } = useStore();
  const [projects, setProjects] = useState<JiraProject[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!projectPickerOpen) return;
    setProjects(null);
    setError("");
    void window.tester.jira.projects().then((r) => {
      if (r.ok) setProjects(r.data);
      else setError(r.error);
    });
  }, [projectPickerOpen]);

  if (!projectPickerOpen) return null;

  const q = filter.trim().toLowerCase();
  const shown = (projects ?? []).filter(
    (p) => !q || p.key.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
  );

  const choose = (key: string) => setProject(key);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-8"
      style={{ background: "rgba(10,8,6,.66)" }}
      onMouseDown={(e) => {
        // Dismissible only once a project is set, so the first run can't be
        // clicked past into a state where nothing can be filed.
        if (e.target === e.currentTarget && project) openProjectPicker(false);
      }}>
      <div className="glass-surface rise flex max-h-[560px] w-[min(520px,92vw)] flex-col rounded-2xl"
        style={{ backdropFilter: "blur(34px) saturate(180%)" }}>

        <div className="border-b px-6 py-5" style={{ borderColor: "var(--border)" }}>
          <div className="kicker mb-1.5">Jira</div>
          <div className="display text-[24px]">Which project are you testing?</div>
          <div className="soft mt-2 text-[12px] leading-relaxed">
            Everything filed from this window goes here. Open a second window to
            test another project side by side.
          </div>
        </div>

        <div className="px-6 pt-4">
          <input
            className="field"
            autoFocus
            placeholder="Filter projects…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) choose(shown[0].key); }}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
          {error && (
            <div className="chip chip--warn w-full !justify-start">
              <Icon name="alert" size={12} /> <span className="min-w-0 break-words">{error}</span>
            </div>
          )}

          {!projects && !error && (
            <div className="faint flex items-center gap-2 py-6 text-[12px]">
              <span className="spin"><Icon name="reload" size={13} /></span> Loading projects…
            </div>
          )}

          {projects && shown.length === 0 && !error && (
            <div className="faint py-6 text-[12px]">No project matches “{filter}”.</div>
          )}

          <div className="space-y-1.5">
            {shown.map((p) => (
              <button
                key={p.key}
                className={`glass-inset flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${
                  p.key === project ? "!border-current" : ""}`}
                style={p.key === project ? { borderColor: "rgb(var(--primary-soft))" } : undefined}
                onClick={() => choose(p.key)}
              >
                <span className="mono shrink-0 rounded-md px-2 py-1 text-[11px] font-bold"
                  style={{ background: "rgb(var(--primary) / .22)", color: "rgb(var(--primary-soft))" }}>
                  {p.key}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{p.name}</span>
                {p.key === project && <Icon name="check" size={13} style={{ color: "rgb(var(--accent))" }} />}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t px-6 py-4" style={{ borderColor: "var(--border)" }}>
          <button className="btn btn--ghost" onClick={() => useStore.getState().openSettings(true)}>
            <Icon name="gear" /> Jira settings
          </button>
          <span className="flex-1" />
          {project && (
            <button className="btn" onClick={() => openProjectPicker(false)}>
              Keep {project}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
