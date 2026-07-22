// Settings: Jira connection, LLM endpoint, and defaults. Every field writes to a
// local draft; nothing is persisted until Save, so a half-typed token can't break
// a working connection.

import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useStore } from "./store.js";
import { Icon } from "./Icons.js";
import type { AppSettings, JiraBoard, JiraProject } from "../../shared/types.js";
import { LANGS, hasBuiltInStrings } from "../../shared/i18n.js";

type Probe = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; text: string } | { kind: "error"; text: string };

export default function Settings(): JSX.Element | null {
  const { settingsOpen, settings, setSettings, openSettings } = useStore();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [tab, setTab] = useState<"jira" | "ai" | "general">("jira");
  const [probe, setProbe] = useState<Probe>({ kind: "idle" });
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [saved, setSaved] = useState(false);
  const [logins, setLogins] = useState(0);

  useEffect(() => { if (settingsOpen) { setDraft(settings); setProbe({ kind: "idle" }); } }, [settingsOpen, settings]);
  useEffect(() => { if (settingsOpen) void window.tester.auth.savedCount().then(setLogins); }, [settingsOpen]);

  if (!settingsOpen) return null;

  const j = draft.jira;
  const setJira = (p: Partial<AppSettings["jira"]>) => setDraft({ ...draft, jira: { ...draft.jira, ...p } });
  const setLlm = (p: Partial<AppSettings["llm"]>) => setDraft({ ...draft, llm: { ...draft.llm, ...p } });

  /** Testing has to persist first — the main process reads credentials from the
   *  saved settings, not from this draft. */
  const save = async (): Promise<void> => {
    const next = await window.tester.settings.set(draft);
    setSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const test = async (): Promise<void> => {
    setProbe({ kind: "busy" });
    await save();
    const r = await window.tester.jira.test();
    if (!r.ok) { setProbe({ kind: "error", text: r.error }); return; }
    setProbe({ kind: "ok", text: `Connected as ${r.data}` });
    const [p, b] = await Promise.all([window.tester.jira.projects(), window.tester.jira.boards()]);
    if (p.ok) setProjects(p.data);
    if (b.ok) setBoards(b.data);
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-8"
      style={{ background: "rgba(10,8,6,.6)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) openSettings(false); }}>
      <div className="glass-surface rise flex h-full max-h-[720px] w-[min(760px,94vw)] flex-col rounded-2xl"
        style={{ backdropFilter: "blur(34px) saturate(180%)" }}>

        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <div className="kicker mb-1.5">Settings</div>
            <div className="display text-[24px]">Connections</div>
          </div>
          <button className="btn btn--icon btn--ghost" onClick={() => openSettings(false)}>
            <Icon name="close" />
          </button>
        </div>

        <div className="flex gap-1.5 px-6 pt-4">
          {(["jira", "ai", "general"] as const).map((t) => (
            <button key={t} className={`btn ${tab === t ? "btn--on" : "btn--ghost"}`} onClick={() => setTab(t)}>
              {t === "jira" ? "Jira" : t === "ai" ? "AI" : "General"}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {tab === "jira" && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="label">Jira endpoint</label>
                  <input className="field mono !text-[12px]" value={j.endpoint}
                    onChange={(e) => setJira({ endpoint: e.target.value.trim() })}
                    placeholder="https://jira.yourcompany.com" />
                </div>
                <div>
                  <label className="label">Deployment</label>
                  <select className="field" value={j.deployment}
                    onChange={(e) => setJira({ deployment: e.target.value as "datacenter" | "cloud" })}>
                    <option value="datacenter">Data Center / Server</option>
                    <option value="cloud">Cloud</option>
                  </select>
                </div>
              </div>

              {j.deployment === "cloud" && (
                <div>
                  <label className="label">Account email</label>
                  <input className="field" value={j.email}
                    onChange={(e) => setJira({ email: e.target.value.trim() })}
                    placeholder="you@company.com" />
                </div>
              )}

              <div>
                <label className="label">
                  {j.deployment === "cloud" ? "API token" : "Personal access token (PAT)"}
                </label>
                <input className="field mono !text-[12px]" type="password" value={j.token}
                  onChange={(e) => setJira({ token: e.target.value.trim() })}
                  placeholder="••••••••••••" />
                <div className="faint mt-1.5 text-[10.5px]">
                  Stored locally in this app's data directory, readable only by your user account.
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Default project</label>
                  {projects.length ? (
                    <select className="field" value={j.projectKey}
                      onChange={(e) => setJira({ projectKey: e.target.value })}>
                      <option value="">Select…</option>
                      {projects.map((p) => <option key={p.key} value={p.key}>{p.key} — {p.name}</option>)}
                    </select>
                  ) : (
                    <input className="field" value={j.projectKey}
                      onChange={(e) => setJira({ projectKey: e.target.value.trim().toUpperCase() })}
                      placeholder="RTT" />
                  )}
                </div>
                <div>
                  <label className="label">Issue type</label>
                  <input className="field" value={j.issueType}
                    onChange={(e) => setJira({ issueType: e.target.value })} placeholder="Bug" />
                </div>
                <div>
                  <label className="label">Default labels</label>
                  <input className="field" value={j.labels.join(", ")}
                    onChange={(e) => setJira({ labels: e.target.value.split(",").map((l) => l.trim()).filter(Boolean) })}
                    placeholder="qa, redstone-tester" />
                </div>
              </div>

              <div className="faint -mt-1 text-[10.5px]">
                New windows start here; each window can be switched to a different
                project from the title bar.
              </div>

              <div className="glass-inset rounded-xl p-3">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input type="checkbox" checked={j.autoAddToSprint}
                    onChange={(e) => setJira({ autoAddToSprint: e.target.checked })}
                    style={{ accentColor: "rgb(var(--primary))" }} />
                  <span className="text-[13px]">Add new tickets to the active sprint</span>
                </label>
                {j.autoAddToSprint && (
                  <div className="mt-3">
                    <label className="label">Board</label>
                    {boards.length ? (
                      <select className="field" value={j.boardId}
                        onChange={(e) => setJira({ boardId: e.target.value })}>
                        <option value="">Auto-detect from project</option>
                        {boards.map((b) => <option key={b.id} value={String(b.id)}>{b.name} (#{b.id})</option>)}
                      </select>
                    ) : (
                      <input className="field" value={j.boardId}
                        onChange={(e) => setJira({ boardId: e.target.value.trim() })}
                        placeholder="Leave empty to auto-detect — test the connection to list boards" />
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button className="btn" onClick={() => void test()} disabled={probe.kind === "busy"}>
                  {probe.kind === "busy"
                    ? <><span className="spin"><Icon name="reload" /></span> Testing…</>
                    : <><Icon name="link" /> Test connection</>}
                </button>
                {probe.kind === "ok" && (
                  <span className="chip chip--live"><Icon name="check" size={12} /> {probe.text}</span>
                )}
                {probe.kind === "error" && (
                  <span className="chip chip--warn min-w-0"><Icon name="alert" size={12} />
                    <span className="truncate max-w-[380px]">{probe.text}</span></span>
                )}
              </div>
            </>
          )}

          {tab === "ai" && (
            <>
              <div>
                <label className="label">OpenAI-compatible endpoint</label>
                <input className="field mono !text-[12px]" value={draft.llm.endpoint}
                  onChange={(e) => setLlm({ endpoint: e.target.value.trim() })}
                  placeholder="https://api.openai.com/v1" />
                <div className="faint mt-1.5 text-[10.5px]">
                  Anything speaking <code>/chat/completions</code> works — OpenAI, a gateway, or a local runtime.
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">API key</label>
                  <input className="field mono !text-[12px]" type="password" value={draft.llm.apiKey}
                    onChange={(e) => setLlm({ apiKey: e.target.value.trim() })} placeholder="sk-…" />
                </div>
                <div>
                  <label className="label">Model</label>
                  <input className="field mono !text-[12px]" value={draft.llm.model}
                    onChange={(e) => setLlm({ model: e.target.value.trim() })} placeholder="gpt-4o-mini" />
                </div>
              </div>
              {/* Two independent languages. Being asked in one and filing in
                  another is a normal setup on a mixed-language team, so neither
                  derives from the other. Free text with a preset list: an LLM
                  handles any language, so the app should not limit the choice. */}
              <datalist id="rtt-langs">
                {LANGS.map((l) => <option key={l} value={l} />)}
              </datalist>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Ask me questions in</label>
                  <input className="field" list="rtt-langs" value={draft.llm.questionLang}
                    onChange={(e) => setLlm({ questionLang: e.target.value })}
                    placeholder="English" />
                  <div className="faint mt-1.5 text-[10.5px]">
                    The AI's questions and critique — what you read while filing.
                  </div>
                </div>
                <div>
                  <label className="label">Write the ticket in</label>
                  <input className="field" list="rtt-langs" value={draft.llm.ticketLang}
                    onChange={(e) => setLlm({ ticketLang: e.target.value })}
                    placeholder="English" />
                  <div className="faint mt-1.5 text-[10.5px]">
                    The ticket itself — what the developer reads.
                    {!hasBuiltInStrings(draft.llm.ticketLang) && draft.llm.ticketLang.trim() && (
                      <> Section headings are translated by the AI on first review.</>
                    )}
                  </div>
                </div>
              </div>
              <div className="faint -mt-1 text-[10.5px]">
                Selectors, DOM paths, URLs and console output are never translated —
                a developer has to match those against the real product.
              </div>

              <div className="glass-inset rounded-xl p-3">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input type="checkbox" checked={draft.llm.vision}
                    onChange={(e) => setLlm({ vision: e.target.checked })}
                    style={{ accentColor: "rgb(var(--primary))" }} />
                  <span className="text-[13px]">Send the screenshot to the model</span>
                </label>
                <div className="faint mt-1.5 text-[10.5px]">
                  Lets a vision model describe the defect it can see. Turn off if the model has no
                  vision support, or if pages under test show data that must not leave this machine.
                </div>
              </div>
            </>
          )}

          {tab === "general" && (
            <>
              <div>
                <label className="label">Home page</label>
                <input className="field mono !text-[12px]" value={draft.homeUrl}
                  onChange={(e) => setDraft({ ...draft, homeUrl: e.target.value.trim() })}
                  placeholder="https://staging.yourapp.com" />
              </div>
              <div>
                <label className="label">Your name</label>
                <input className="field" value={draft.tester}
                  onChange={(e) => setDraft({ ...draft, tester: e.target.value })}
                  placeholder="Stamped in the ticket footer" />
              </div>

              {/* Site logins are stored apart from settings, so clearing them is
                  a distinct, obvious action rather than buried in a form. */}
              <div className="glass-inset rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <Icon name="user" size={13} className="opacity-60" />
                  <span className="text-[13px]">Saved site logins</span>
                  <span className="chip !py-0.5 !text-[10px]">{logins}</span>
                  <span className="flex-1" />
                  <button className="btn btn--ghost !px-2.5 !py-1 !text-[11.5px]"
                    disabled={!logins}
                    onClick={() => { void window.tester.auth.forgetAll().then(() => setLogins(0)); }}>
                    <Icon name="trash" size={12} /> Forget all
                  </button>
                </div>
                <div className="faint mt-1.5 text-[10.5px] leading-relaxed">
                  Usernames and passwords you chose to remember for sites behind
                  HTTP authentication. Kept in a private file on this machine,
                  never in a ticket.
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t px-6 py-4" style={{ borderColor: "var(--border)" }}>
          <span className="faint text-[11px]">Redstone Tester</span>
          <span className="flex-1" />
          <button className="btn btn--ghost" onClick={() => openSettings(false)}>Cancel</button>
          <button className="btn btn--clay" onClick={() => void save()}>
            {saved ? <><Icon name="check" /> Saved</> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
