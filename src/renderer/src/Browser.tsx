// The embedded browser: tab strip, address bar, bookmarks, device frame, capture
// modes and recording — plus the wiring that turns guest console signals into
// annotations, recorded steps and screenshots.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { WebviewEl } from "./env.js";
import { useStore } from "./store.js";
import { parseAnnotate, parseStep, pinToAnnotation } from "./guest.js";
import { annotateShot, cropShot } from "./crop.js";
import type { Annotation, CaptureContext, Ticket } from "../../shared/types.js";
import { Icon } from "./Icons.js";
import { derivedSteps, normalizeAddress, pathOf } from "./urls.js";
import {
  DEVICES, DEVICE_GROUPS, FIT, deviceById, describeDevice, fitScale, orient, userAgentFor,
} from "./devices.js";
import { isBookmarked, tabLabel } from "../../shared/tabs.js";
import { fill, recorderPhrases } from "../../shared/i18n.js";
import type { Tab } from "../../shared/tabs.js";
import StepsPanel from "./StepsPanel.js";
import GuestView from "./GuestView.js";
import Bookmarks from "./Bookmarks.js";

export default function Browser(): JSX.Element {
  const {
    settings, mode, annotations, steps, consoleErrors, recording, stepsOpen,
    deviceId, orientation, viewport, tabs, activeId, bookmarks, armError,
    setNav, setMode, setDevice, setOrientation, setRecording, openSteps, setArmError,
    openTab, shutTab, focusTab, updateTab, bookmark, unbookmark,
    addAnnotation, patchAnnotation, removeAnnotation, clearAnnotations,
    addStep, addConsoleError, openComposer, capture,
  } = useStore();

  const guests = useRef(new Map<string, WebviewEl>());
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [address, setAddress] = useState("");
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [loadedUa, setLoadedUa] = useState<string | null>(null);
  /** While the address bar has focus we must not overwrite what is being typed. */
  const [editing, setEditing] = useState(false);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  // Read from the tab, not from a shared flag: switching tabs must not inherit
  // the previous tab's readiness.
  const activeReady = active?.ready ?? false;
  const device = orient(deviceById(deviceId), orientation);
  const scale = fitScale(device, stage);
  const isFit = device.id === FIT.id;
  const uaStale = loadedUa !== null && userAgentFor(deviceById(deviceId)) !== loadedUa;

  const live = useRef({ annotations, steps, consoleErrors, activeId });
  live.current = { annotations, steps, consoleErrors, activeId };

  const activeGuest = useCallback((): WebviewEl | null =>
    guests.current.get(useStore.getState().activeId) ?? null, []);

  const register = useCallback((id: string, el: WebviewEl | null) => {
    if (el) guests.current.set(id, el);
    else guests.current.delete(id);
  }, []);

  useEffect(() => {
    if (!editing) setAddress(active?.url ?? "");
  }, [active?.url, activeId, editing]);

  // Mirror the active tab into the flat nav state the composer and title bar read.
  useEffect(() => {
    setNav({ url: active?.url ?? "", title: active?.title ?? "", loading: active?.loading ?? false });
  }, [active?.url, active?.title, active?.loading, setNav]);

  const go = useCallback((raw: string) => {
    const next = normalizeAddress(raw);
    if (!next) return;
    setAddress(next);
    const wv = activeGuest();
    if (!wv) return;
    updateTab(useStore.getState().activeId, { url: next, loading: true });
    wv.loadURL(next).catch(() => {
      // Unreachable host: the guest renders its own error page.
    });
  }, [activeGuest, updateTab]);

  // ── device frame sizing ───────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setStage({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── screenshots / environment ─────────────────────────────────────────────
  const capturePage = useCallback(async (): Promise<string | undefined> => {
    const wv = activeGuest();
    if (!wv) return undefined;
    try {
      return (await wv.capturePage()).toDataURL();
    } catch {
      return undefined; // capture can fail mid-navigation; the ticket still stands
    }
  }, [activeGuest]);

  /** Read the guest's live viewport and UA. This is the truth — the device frame
   *  is what we asked for, this is what the page actually got. */
  const readEnv = useCallback(async () => {
    const wv = activeGuest();
    if (!wv) return;
    try {
      const r = await wv.executeJavaScript(
        `({ w: innerWidth, h: innerHeight, ua: navigator.userAgent })`,
      ) as { w: number; h: number; ua: string };
      setNav({ viewport: { w: r.w, h: r.h }, userAgent: r.ua });
    } catch { /* guest not ready */ }
  }, [activeGuest, setNav]);

  // The guest's innerWidth only settles after a re-layout, so re-read it whenever
  // the frame or the active tab changes rather than trusting the preset.
  useEffect(() => {
    if (!activeReady) return;
    const id = setTimeout(() => void readEnv(), 120);
    return () => clearTimeout(id);
  }, [deviceId, orientation, stage.w, stage.h, activeId, activeReady, readEnv]);

  useEffect(() => {
    if (activeReady) setLoadedUa(userAgentFor(deviceById(useStore.getState().deviceId)));
  }, [activeReady, activeId]);

  // ── guest events ──────────────────────────────────────────────────────────
  const handleAnnotate = useCallback(async (ev: ReturnType<typeof parseAnnotate>) => {
    if (!ev) return;

    if (ev.t === "exit") { setMode("off"); return; }
    if (ev.t === "err") { setArmError(ev.m); setMode("off"); return; }
    if (ev.t === "unpin") { removeAnnotation(ev.id); return; }

    if (ev.t === "pin") {
      const a = pinToAnnotation(ev);
      addAnnotation(a);
      const shot = await capturePage();
      if (shot) patchAnnotation(a.id, { shot: await cropShot(shot, a.box, a.vw, 10) });
      return;
    }

    if (ev.t === "region") {
      const a: Annotation = {
        id: ev.id, kind: "region", note: "", box: ev.box, vw: ev.vw, vh: ev.vh, url: ev.url,
      };
      addAnnotation(a);
      const shot = await capturePage();
      if (shot) patchAnnotation(a.id, { shot: await cropShot(shot, a.box, a.vw, 0) });
      return;
    }

    if (ev.t === "submit") {
      const noted = live.current.annotations.map((a) => ({
        ...a, note: ev.notes.find((n) => n.id === a.id)?.note ?? a.note,
      }));

      const raw = await capturePage();
      const pageShot = raw
        ? await annotateShot(raw, noted.map((a) => ({ box: a.box, id: a.id })), noted[0]?.vw || 1280)
        : undefined;

      const st = useStore.getState();
      const ctx: CaptureContext = {
        url: ev.url,
        title: ev.title,
        annotations: noted,
        steps: live.current.steps,
        pageShot,
        viewport: st.viewport,
        device: describeDevice(deviceById(st.deviceId), st.orientation, st.viewport),
        userAgent: st.userAgent,
        consoleErrors: live.current.consoleErrors,
      };

      const notes = noted.map((a) => a.note).filter(Boolean);
      const ticket: Ticket = {
        summary: notes[0] ? notes[0].slice(0, 110) : `Defect on ${pathOf(ev.url)}`,
        description: "",
        stepsToReproduce: derivedSteps(ctx, st.settings.llm.ticketLang),
        expected: "",
        current: notes.join("\n") || "",
        severity: "Major",
        environment: "",
        labels: [],
      };
      openComposer(ctx, ticket);
      setMode("off");
    }
  }, [addAnnotation, patchAnnotation, removeAnnotation, capturePage, openComposer, setMode, setArmError]);

  const onGuestConsole = useCallback((id: string, message: string, level: number) => {
    // Only the focused tab feeds a ticket. A background page that logs or
    // redirects must not appear in someone else's evidence.
    if (id !== live.current.activeId) return;

    const step = parseStep(message);
    if (step) { addStep(step); return; }

    const ann = parseAnnotate(message);
    if (ann) { void handleAnnotate(ann); return; }

    // Electron levels: 0 verbose, 1 info, 2 warning, 3 error.
    if (level === 3) addConsoleError(message.slice(0, 400));
  }, [addStep, addConsoleError, handleAnnotate]);

  const onGuestNavigate = useCallback((id: string, url: string) => {
    if (id !== live.current.activeId) return;
    // Must match the phrasing the injected recorder uses, or a recording reads
    // as two different voices.
    const open = recorderPhrases(useStore.getState().settings.llm.ticketLang).open;
    addStep({ t: Date.now(), kind: "navigate", text: `${open} ${url}`, url });
  }, [addStep]);

  const onReadyChange = useCallback((id: string, ready: boolean) => {
    updateTab(id, { ready });
  }, [updateTab]);

  const onInjectError = useCallback((id: string, message: string) => {
    if (id !== useStore.getState().activeId) return;
    setArmError(message);
  }, [setArmError]);

  // Recording anchors itself at the page the run started on.
  useEffect(() => {
    if (!recording) return;
    const at = activeGuest()?.getURL() || useStore.getState().url;
    const open = recorderPhrases(useStore.getState().settings.llm.ticketLang).open;
    if (at) addStep({ t: Date.now(), kind: "navigate", text: `${open} ${at}`, url: at });
    // Only when recording flips on — not on every tab change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const toggle = (m: "element" | "region") => {
    if (mode === m) { setMode("off"); return; }
    if (!capture && annotations.length) clearAnnotations();
    setMode(m);
  };

  const applyDevice = (id: string) => {
    setDevice(id);
    const ua = userAgentFor(deviceById(id));
    // Applies to subsequent navigations; the page keeps its current UA until the
    // tester reloads, so a half-filled form is never destroyed by a preset change.
    for (const g of guests.current.values()) {
      try { g.setUserAgent(ua ?? ""); } catch { /* not attached yet */ }
    }
  };

  const wv = activeGuest();
  const saved = active ? isBookmarked(bookmarks, active.url) : false;

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* tab strip */}
      <div className="no-drag flex items-end gap-1 px-3 pb-1.5">
        <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <TabChip
              key={t.id}
              tab={t}
              active={t.id === activeId}
              closable={tabs.length > 1}
              onSelect={() => focusTab(t.id)}
              onClose={() => shutTab(t.id)}
            />
          ))}
        </div>
        <button className="btn btn--icon btn--ghost shrink-0"
          onClick={() => openTab(settings.homeUrl)} title="New tab (⌘T)">
          <Icon name="plus" />
        </button>
      </div>

      {/* address + controls */}
      <div className="no-drag flex items-center gap-2 px-3 pb-2">
        <div className="flex items-center gap-1">
          <button className="btn btn--icon btn--ghost" disabled={!active?.back}
            onClick={() => wv?.goBack()} title="Back"><Icon name="back" /></button>
          <button className="btn btn--icon btn--ghost" disabled={!active?.fwd}
            onClick={() => wv?.goForward()} title="Forward"><Icon name="fwd" /></button>
          <button className="btn btn--icon btn--ghost"
            onClick={() => (active?.loading ? wv?.stop() : wv?.reload())}
            title={active?.loading ? "Stop" : "Reload"}>
            <Icon name={active?.loading ? "close" : "reload"} />
          </button>
        </div>

        <form className="flex min-w-0 flex-1 items-center"
          onSubmit={(e) => { e.preventDefault(); setEditing(false); go(address); }}>
          <div className="glass-inset flex min-w-0 flex-1 items-center gap-2 rounded-full px-3.5 py-1.5">
            {active?.loading
              ? <span className="tabspin shrink-0" />
              : <Icon name="globe" className="shrink-0 opacity-45" />}
            <input
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
              style={{ fontFamily: "var(--font-mono)" }}
              value={address}
              spellCheck={false}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={(e) => { setEditing(true); e.currentTarget.select(); }}
              onBlur={() => setEditing(false)}
              placeholder="Enter a URL to test…"
            />
            <button
              type="button"
              className="btn btn--icon btn--ghost !h-6 !w-6 shrink-0"
              title={saved ? "Remove bookmark" : "Bookmark for this project"}
              onClick={() => {
                if (!active?.url) return;
                if (saved) unbookmark(active.url);
                else bookmark({ url: active.url, title: active.title || active.url });
              }}
            >
              <Icon name={saved ? "starOn" : "star"}
                style={saved ? { color: "rgb(var(--accent))" } : undefined} />
            </button>
          </div>
        </form>

        <div className="flex items-center gap-1.5">
          <button className={`btn ${mode === "element" ? "btn--on" : ""}`}
            onClick={() => toggle("element")} title="Click elements that look wrong (⌘⇧E)">
            <Icon name="target" /> Highlight
          </button>
          <button className={`btn ${mode === "region" ? "btn--on" : ""}`}
            onClick={() => toggle("region")} title="Drag a box around the defect (⌘⇧R)">
            <Icon name="crop" /> Region
          </button>
          <button className="btn btn--icon btn--ghost"
            onClick={() => (wv?.isDevToolsOpened() ? wv.closeDevTools() : wv?.openDevTools())}
            title="Inspect page"><Icon name="code" /></button>
        </div>
      </div>

      <Bookmarks onOpen={(url, inNewTab) => (inNewTab ? openTab(url) : go(url))} />

      {/* device + recording strip */}
      <div className="no-drag flex items-center gap-2 px-3 pb-2 text-[11px]">
        <select className="field !w-auto !py-1 !text-[11.5px]" value={deviceId}
          onChange={(e) => applyDevice(e.target.value)} title="Emulate a device size">
          <option value={FIT.id}>{FIT.name}</option>
          {DEVICE_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {DEVICES.filter((d) => d.group === g).map((d) => (
                <option key={d.id} value={d.id}>{d.name} · {d.w}×{d.h}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {!isFit && (
          <button className="btn btn--icon btn--ghost" title="Rotate"
            onClick={() => setOrientation(orientation === "portrait" ? "landscape" : "portrait")}>
            <Icon name="rotate" />
          </button>
        )}

        <span className="chip mono" title="Viewport the page actually sees (CSS pixels)">
          <Icon name="frame" size={11} className="opacity-60" />
          {viewport.w || device.w || "—"}×{viewport.h || device.h || "—"}
          {!isFit && scale < 1 && <span className="faint"> · {Math.round(scale * 100)}%</span>}
          {device.dpr !== 1 && <span className="faint"> · @{device.dpr}x</span>}
        </span>

        {uaStale && (
          <button className="chip chip--warn" onClick={() => wv?.reload()}
            title="This device presents a different user agent; reload to apply it">
            <Icon name="reload" size={11} /> Reload for {deviceById(deviceId).mobile ? "mobile" : "desktop"} UA
          </button>
        )}

        <span className="w-px self-stretch" style={{ background: "var(--border)" }} />

        <button className={`btn !py-1 !text-[11.5px] ${recording ? "btn--on" : ""}`}
          onClick={() => setRecording(!recording)}
          title={recording ? "Stop recording steps" : "Record the steps to reproduce"}>
          {recording
            ? <><span className="dot pulse" style={{ color: "rgb(var(--primary-soft))" }} /> Stop recording</>
            : <><Icon name="record" size={11} /> Record steps</>}
        </button>

        <button className={`chip ${steps.length ? "chip--live" : ""}`}
          onClick={() => openSteps(!stepsOpen)} title="Show the recorded steps">
          <Icon name="steps" size={11} className="opacity-70" />
          {steps.length} step{steps.length === 1 ? "" : "s"}
          <Icon name={stepsOpen ? "chevUp" : "chevDown"} size={10} className="opacity-60" />
        </button>

        {/* Turning a mode on while the page is still loading arms it on the next
            dom-ready. Say so, rather than looking like a dead button. */}
        {mode !== "off" && !activeReady && !armError && (
          <span className="chip chip--warn">
            <span className="tabspin" style={{ width: 9, height: 9 }} /> arming on load…
          </span>
        )}
        {armError && (
          <button className="chip chip--warn" title={`The capture overlay could not attach to this page: ${armError}`}
            onClick={() => { setArmError(null); wv?.reload(); }}>
            <Icon name="alert" size={11} /> Capture blocked — reload
          </button>
        )}
        {annotations.length > 0 && (
          <span className="chip chip--live"><span className="dot" /> {annotations.length} highlighted</span>
        )}
        {consoleErrors.length > 0 && (
          <span className="chip chip--warn"><Icon name="alert" size={11} /> {consoleErrors.length} console error{consoleErrors.length === 1 ? "" : "s"}</span>
        )}

        <span className="flex-1" />
        <span className="faint max-w-[200px] truncate">{active?.title}</span>
      </div>

      {stepsOpen && <StepsPanel />}

      {/* stage — every tab stays mounted; only the active one is displayed */}
      <div ref={stageRef}
        className="relative mx-3 mb-3 flex flex-1 items-center justify-center overflow-hidden">
        <div className="relative"
          style={isFit
            ? { width: "100%", height: "100%" }
            : { width: device.w * scale, height: device.h * scale }}>
          <div
            className="glass-surface absolute left-0 top-0 overflow-hidden"
            style={isFit
              ? { width: "100%", height: "100%", borderRadius: 16 }
              : {
                width: device.w,
                height: device.h,
                borderRadius: deviceById(deviceId).mobile ? 22 : 12,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
          >
            {/* Loading feedback lives on the frame, not the page: the guest
                paints over host DOM, so anything inside it would be hidden. */}
            {active?.loading && <><div className="loadveil" /><div className="loadbar" /></>}
            {tabs.map((t) => (
              <GuestView
                key={t.id}
                tab={t}
                active={t.id === activeId}
                mode={mode}
                recording={recording}
                lang={settings.llm.ticketLang}
                // FIT never transforms the frame; every other device is drawn at
                // `scale`, so that is what the overlay must counter for.
                frameScale={isFit ? 1 : scale}
                register={register}
                onNavigate={onGuestNavigate}
                onState={updateTab}
                onConsole={onGuestConsole}
                onReadyChange={onReadyChange}
                onInjectError={onInjectError}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabChip({ tab, active, closable, onSelect, onClose }: {
  tab: Tab; active: boolean; closable: boolean; onSelect: () => void; onClose: () => void;
}): JSX.Element {
  return (
    <div
      className={`group flex min-w-0 max-w-[190px] shrink-0 cursor-default items-center gap-1.5 rounded-t-lg px-2.5 py-1.5 text-[11.5px] ${
        active ? "glass-surface" : "glass-inset"}`}
      style={active ? undefined : { opacity: .7 }}
      onMouseDown={onSelect}
      title={tab.url}
    >
      {tab.loading
        ? <span className="tabspin shrink-0" />
        : <Icon name="globe" size={11} className="shrink-0 opacity-40" />}
      <span className="min-w-0 flex-1 truncate">{tabLabel(tab)}</span>
      {closable && (
        <button
          className="btn btn--icon btn--ghost !h-4 !w-4 shrink-0 opacity-0 group-hover:opacity-100"
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onClose(); }}
          title="Close tab"
        >
          <Icon name="close" size={10} />
        </button>
      )}
    </div>
  );
}
