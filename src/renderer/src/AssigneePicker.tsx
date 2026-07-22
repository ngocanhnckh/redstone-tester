// Who the bug goes to.
//
// Two things this has to get right. It must be *visible* — a bare <select> in a
// row of buttons is easy to miss, and an unassigned bug sits in the backlog
// until someone triages it. And it must be *ordered by who is actually working
// on the project*: an alphabetical roster of everyone with permission buries the
// three people who could pick this up today.

import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useStore } from "./store.js";
import { Icon } from "./Icons.js";
import type { JiraUser } from "../../shared/types.js";

interface Props {
  value: string;
  onChange: (id: string) => void;
  project: string;
}

export default function AssigneePicker({ value, onChange, project }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<JiraUser[] | null>(null);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  const load = (q: string): void => {
    setError("");
    void window.tester.jira.assignees(q, project).then((r) => {
      if (r.ok) setUsers(r.data);
      else { setUsers([]); setError(r.error); }
    });
  };

  // Load once when the composer opens, so the list is ready before it is opened.
  useEffect(() => { load(""); /* eslint-disable-next-line */ }, [project]);

  // Re-query on typing: an older Jira ignores the server-side query, so the
  // result is narrowed client-side too, but a large directory needs the server.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(query), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = users?.find((u) => u.id === value) ?? null;
  const active = (users ?? []).filter((u) => u.active);
  const others = (users ?? []).filter((u) => !u.active);

  const pick = (id: string) => { onChange(id); setOpen(false); setQuery(""); };

  return (
    <div className="relative" ref={boxRef}>
      <label className="label">Assignee</label>
      <button
        type="button"
        className="glass-inset flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left"
        onClick={() => setOpen(!open)}
      >
        {selected?.avatar
          ? <img src={selected.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full" />
          : <Icon name="user" size={14} className="shrink-0 opacity-50" />}
        <span className={`min-w-0 flex-1 truncate text-[13px] ${selected ? "" : "faint"}`}>
          {selected ? selected.displayName : "Unassigned"}
        </span>
        {selected?.issueCount ? (
          <span className="chip !py-0.5 !text-[10px]">{selected.issueCount} in {project}</span>
        ) : null}
        <Icon name="chevDown" size={12} className="shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="glass-surface rise absolute z-50 mt-1 max-h-[300px] w-full overflow-hidden rounded-xl"
          style={{ backdropFilter: "blur(30px) saturate(180%)" }}>
          <div className="border-b p-2" style={{ borderColor: "var(--border)" }}>
            <input
              className="field !py-1.5 !text-[12px]"
              autoFocus
              placeholder="Search people…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="max-h-[236px] overflow-y-auto p-1.5">
            <Row
              label="Unassigned"
              selected={!value}
              onClick={() => pick("")}
            />

            {users === null && (
              <div className="faint flex items-center gap-2 px-2 py-3 text-[12px]">
                <span className="spin"><Icon name="reload" size={12} /></span> Loading people…
              </div>
            )}

            {error && (
              <div className="chip chip--warn m-1 w-[calc(100%-8px)] !justify-start">
                <Icon name="alert" size={11} />
                <span className="min-w-0 break-words">{error}</span>
              </div>
            )}

            {active.length > 0 && (
              <>
                <div className="label !mb-1 mt-2 px-2">Working on {project}</div>
                {active.map((u) => (
                  <Row
                    key={u.id}
                    label={u.displayName}
                    hint={u.issueCount ? `${u.issueCount} issue${u.issueCount === 1 ? "" : "s"}` : undefined}
                    avatar={u.avatar}
                    selected={u.id === value}
                    onClick={() => pick(u.id)}
                  />
                ))}
              </>
            )}

            {others.length > 0 && (
              <>
                {active.length > 0 && <div className="label !mb-1 mt-2 px-2">Everyone else</div>}
                {others.map((u) => (
                  <Row
                    key={u.id}
                    label={u.displayName}
                    avatar={u.avatar}
                    selected={u.id === value}
                    onClick={() => pick(u.id)}
                  />
                ))}
              </>
            )}

            {users?.length === 0 && !error && (
              <div className="faint px-2 py-3 text-[12px]">No one matches “{query}”.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, hint, avatar, selected, onClick }: {
  label: string; hint?: string; avatar?: string; selected: boolean; onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] ${
        selected ? "btn--on" : "hover:bg-white/5"}`}
      onClick={onClick}
    >
      {avatar
        ? <img src={avatar} alt="" className="h-5 w-5 shrink-0 rounded-full" />
        : <Icon name="user" size={13} className="shrink-0 opacity-40" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="faint shrink-0 text-[10.5px]">{hint}</span>}
      {selected && <Icon name="check" size={12} style={{ color: "rgb(var(--accent))" }} />}
    </button>
  );
}
