import { useEffect, useRef } from "react";
import type { JSX } from "react";
import Browser from "./Browser.js";
import Composer from "./Composer.js";
import Settings from "./Settings.js";
import ProjectPicker from "./ProjectPicker.js";
import AuthPrompt from "./AuthPrompt.js";
import { Icon } from "./Icons.js";
import { useStore } from "./store.js";
import Queue from "./Queue.js";
import { DEFAULT_QUEUE, restore, snapshot } from "../../shared/tabs.js";

export default function App(): JSX.Element {
  const {
    ready, settings, mode, capture, project, recording, hydrated,
    tabs, activeId, bookmarks, queue,
    openSettings, setSettings, setMode, setProject, openProjectPicker, setRecording,
    hydrate, openTab, shutTab, setAuthChallenge, setQueue,
  } = useStore();

  // A page can challenge for credentials at any moment, including during the
  // very first restore, so this listener is attached before anything else runs.
  useEffect(() => window.tester.auth.onRequest(setAuthChallenge), [setAuthChallenge]);

  useEffect(() => {
    void window.tester.settings.get().then((s) => {
      setSettings(s);
      // A window opened without an explicit project inherits the saved default;
      // if there isn't one, ask before any testing happens rather than failing
      // at submit time.
      const st = useStore.getState();
      if (!st.project && s.jira.projectKey) setProject(s.jira.projectKey);
      const configured = Boolean(s.jira.endpoint && s.jira.token);
      if (configured && !useStore.getState().project) openProjectPicker(true);
    });
  }, [setSettings, setProject, openProjectPicker]);

  // ── per-project workspace ─────────────────────────────────────────────────
  // Restore the project's tabs and bookmarks. Re-runs when the window is pointed
  // at a different project, so switching projects swaps the whole workspace.
  useEffect(() => {
    if (!ready || hydrated) return;
    let cancelled = false;
    void window.tester.workspace.get(project).then((ws) => {
      if (cancelled) return;
      hydrate(restore(ws, settings.homeUrl), ws.bookmarks, ws.queue ?? { ...DEFAULT_QUEUE });
    });
    return () => { cancelled = true; };
  }, [ready, hydrated, project, settings.homeUrl, hydrate]);

  // Persist on change, debounced — a page that redirects a few times would
  // otherwise write the file on every hop.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void window.tester.workspace.set(project, snapshot({ tabs, activeId }, bookmarks, queue));
    }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [hydrated, project, tabs, activeId, bookmarks, queue]);

  // Switching project must not drop whatever the outgoing one had open: the
  // debounced save may not have fired yet, and `hydrated: false` stops it firing
  // at all. Flush the previous project's workspace the moment the key changes.
  const prev = useRef({ project, tabs, activeId, bookmarks, queue, hydrated });
  useEffect(() => {
    const p = prev.current;
    if (p.hydrated && p.project !== project) {
      void window.tester.workspace.set(
        p.project, snapshot({ tabs: p.tabs, activeId: p.activeId }, p.bookmarks, p.queue),
      );
    }
    prev.current = { project, tabs, activeId, bookmarks, queue, hydrated };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === "e") { e.preventDefault(); setMode(mode === "element" ? "off" : "element"); }
      if (meta && e.shiftKey && e.key.toLowerCase() === "r") { e.preventDefault(); setMode(mode === "region" ? "off" : "region"); }
      if (meta && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); setRecording(!recording); }
      if (meta && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); void window.tester.newWindow(); }
      if (meta && e.shiftKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        setQueue({ open: !useStore.getState().queue.open });
      }
      if (meta && e.key.toLowerCase() === "t" && !e.shiftKey) {
        e.preventDefault();
        openTab(useStore.getState().settings.homeUrl);
      }
      if (meta && e.key.toLowerCase() === "w" && !e.shiftKey) {
        e.preventDefault();
        const st = useStore.getState();
        if (st.activeId) shutTab(st.activeId);
      }
      if (meta && e.key === ",") { e.preventDefault(); openSettings(true); }
      if (e.key === "Escape" && mode !== "off") setMode("off");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, recording, setMode, setRecording, openSettings, openTab, shutTab, setQueue]);

  const jiraOn = Boolean(settings.jira.endpoint && settings.jira.token);
  const aiOn = Boolean(settings.llm.endpoint && settings.llm.model);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="atmosphere">
        <div className="blob blob--a" />
        <div className="blob blob--b" />
        <div className="blob blob--c" />
      </div>

      <div className="relative z-10 flex h-full flex-col">
        {/* Title bar. The caption buttons live on the LEFT on macOS (traffic
            lights) and on the RIGHT on Windows (overlay), so the padding has to
            follow the platform or the app's own controls end up underneath them. */}
        <div
          className="drag flex items-center gap-3 px-4 pb-3 pt-3.5"
          style={{
            paddingLeft: window.tester.platform === "darwin" ? 88 : 16,
            paddingRight: window.tester.platform === "win32" ? 152 : 16,
          }}
        >
          <div className="flex items-baseline gap-2.5">
            <span className="display text-[19px]">Redstone Tester</span>
            <span className="kicker">file the bug in 20s</span>
          </div>

          <span className="flex-1" />

          <div className="no-drag flex items-center gap-1.5">
            {jiraOn ? (
              <>
                <button
                  className={`btn !py-1 !text-[11.5px] ${queue.open ? "btn--on" : "btn--ghost"}`}
                  onClick={() => setQueue({ open: !queue.open })}
                  title="Issues waiting on you in this project (⌘⇧Q)"
                >
                  <Icon name="queue" size={12} /> Queue
                </button>
                {/* The project this window files into — always visible, because
                    two windows on two projects look otherwise identical. */}
                <button
                  className="chip chip--live"
                  onClick={() => openProjectPicker(true)}
                  title="Change the project this window files into"
                >
                  <span className="dot" />
                  {project || "Pick a project"}
                  <Icon name="chevDown" size={10} className="opacity-60" />
                </button>
                <button
                  className="btn btn--icon btn--ghost"
                  // Deliberately opens with NO project: two windows on the same
                  // project would both persist one workspace and clobber each
                  // other's tabs. A new window picks its own project.
                  onClick={() => void window.tester.newWindow()}
                  title="New window — test another project side by side (⌘⇧N)"
                >
                  <Icon name="window" />
                </button>
              </>
            ) : (
              <button className="chip" onClick={() => openSettings(true)}
                title="Jira not configured — tickets copy to the clipboard">
                <span className="dot" style={{ opacity: .35 }} /> No Jira
              </button>
            )}

            <span className={`chip ${aiOn ? "chip--live" : ""}`}
              title={aiOn ? `AI: ${settings.llm.model}` : "AI not configured"}>
              <Icon name="sparkle" size={11} /> {aiOn ? settings.llm.model : "No AI"}
            </span>
            <button className="btn btn--icon btn--ghost" onClick={() => openSettings(true)} title="Settings (⌘,)">
              <Icon name="gear" />
            </button>
          </div>
        </div>

        {/* Queue beside the browser, not over it: a tester reads the ticket and
            drives the page at the same time, so neither may hide the other. */}
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            {ready && hydrated && <Browser />}
          </div>
          {ready && hydrated && jiraOn && queue.open && <Queue />}
          {capture && <Composer />}
        </div>
      </div>

      <ProjectPicker />
      <Settings />
      {/* Above everything: a challenge blocks the page load until answered. */}
      <AuthPrompt />
    </div>
  );
}
