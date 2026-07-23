// One tab: a <webview> plus everything that has to be per-guest — its own
// listeners, its own dom-ready gate, and its own injection state.
//
// Background tabs stay mounted (that is what makes them tabs — switching back
// must not reload the page), but they are never injected into: only the active
// tab records steps or shows the annotation overlay, so a background page that
// redirects itself can't write phantom steps into someone's repro path.

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { WebviewEl } from "./env.js";
import { ANNOTATE_TEARDOWN_JS, RECORDER_TEARDOWN_JS, annotateJs, recorderJs } from "./guest.js";
import type { AnnotateMode } from "./guest.js";
import type { Tab } from "../../shared/tabs.js";

export interface GuestEvents {
  onNavigate: (id: string, url: string) => void;
  onState: (id: string, patch: Partial<Tab>) => void;
  onConsole: (id: string, message: string, level: number) => void;
  onReadyChange: (id: string, ready: boolean) => void;
  /** executeJavaScript rejected — the guest refused the injection outright. */
  onInjectError: (id: string, message: string) => void;
}

interface Props extends GuestEvents {
  tab: Tab;
  active: boolean;
  mode: AnnotateMode;
  recording: boolean;
  /** Language the recorder writes its steps in. */
  lang: string;
  /** CSS-transform scale the device frame is drawn at (≤ 1). The overlay dock
   *  counter-scales by its inverse so it stays readable on a shrunk device. */
  frameScale: number;
  /** Hands the element to the parent so it can capture and inject on demand. */
  register: (id: string, el: WebviewEl | null) => void;
}

export default function GuestView({
  tab, active, mode, recording, lang, frameScale, register,
  onNavigate, onState, onConsole, onReadyChange, onInjectError,
}: Props): JSX.Element {
  const ref = useRef<WebviewEl | null>(null);
  // Read the latest scale inside the injection without depending on it: the
  // annotate effect must NOT re-run when the frame resizes, or every window
  // resize would tear the overlay down and lose the tester's pins. Scale changes
  // instead flow through the live setScale path below.
  const scaleRef = useRef(frameScale);
  scaleRef.current = frameScale;
  const [guestReady, setGuestReady] = useState(false);
  const readyRef = useRef(false);
  /** `src` is set ONCE. It is an attribute, so re-rendering it with the tab's
   *  current URL would re-issue a load on every navigation — an endless reload
   *  loop. All later navigation goes through loadURL() on the element. */
  const initialUrl = useRef(tab.url).current;

  /** executeJavaScript throws SYNCHRONOUSLY before dom-ready, so a trailing
   *  .catch() never sees it. Every injection goes through here. */
  const run = useCallback((code: string): void => {
    const wv = ref.current;
    if (!wv || !readyRef.current) return;
    try {
      // Never swallow this. A rejected injection is exactly the "I turned it on
      // and nothing happened" failure, and silence leaves nothing to debug.
      void wv.executeJavaScript(code).catch((e: unknown) =>
        cb.current.onInjectError(cb.current.tabId, (e as Error)?.message ?? String(e)));
    } catch (e) {
      cb.current.onInjectError(cb.current.tabId, (e as Error)?.message ?? String(e));
    }
  }, []);

  // Keep the callbacks in a ref so the listener effect can mount exactly once
  // per guest — re-attaching listeners on every parent render would drop events.
  const cb = useRef({ onNavigate, onState, onConsole, onReadyChange, onInjectError, tabId: tab.id });
  cb.current = { onNavigate, onState, onConsole, onReadyChange, onInjectError, tabId: tab.id };

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    register(tab.id, wv);

    const setReady = (v: boolean) => {
      readyRef.current = v;
      setGuestReady(v);
      cb.current.onReadyChange(cb.current.tabId, v);
    };

    const onDomReady = () => setReady(true);
    const onStart = () => {
      // A new document discards the old one's injections.
      setReady(false);
      tries = 0;
      if (catchUpTimer) clearTimeout(catchUpTimer);
      catchUpTimer = setTimeout(catchUp, 200);
      cb.current.onState(cb.current.tabId, { loading: true });
    };
    const onStop = () => {
      cb.current.onState(cb.current.tabId, {
        loading: false,
        url: wv.getURL(),
        title: wv.getTitle(),
        back: wv.canGoBack(),
        fwd: wv.canGoForward(),
      });
    };
    const onNav = (e: Event) => {
      const url = (e as unknown as { url?: string }).url;
      if (!url) return;
      cb.current.onState(cb.current.tabId, { url });
      cb.current.onNavigate(cb.current.tabId, url);
    };
    const onTitle = (e: Event) =>
      cb.current.onState(cb.current.tabId, { title: (e as unknown as { title?: string }).title ?? "" });
    const onMsg = (e: Event) => {
      const ev = e as unknown as { message?: string; level?: number };
      if (typeof ev.message === "string") {
        cb.current.onConsole(cb.current.tabId, ev.message, ev.level ?? 1);
      }
    };
    const onFail = (e: Event) => {
      const ev = e as unknown as { errorCode?: number; errorDescription?: string; validatedURL?: string };
      if (ev.errorCode === -3) return; // ERR_ABORTED — user-cancelled, not a defect
      cb.current.onConsole(
        cb.current.tabId,
        `Load failed (${ev.errorDescription ?? ev.errorCode}) — ${ev.validatedURL ?? ""}`,
        3,
      );
    };

    // dom-ready fires ONCE per document, and it can fire before this effect
    // attaches — several tabs restoring at once, or a cached page, is enough to
    // lose it. A missed event leaves the guest permanently "not ready": no
    // injection, and the UI stuck on "arming on load". So also poll the guest
    // directly; accepting a trivial script is authoritative proof it is ready.
    let catchUpTimer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const catchUp = () => {
      if (readyRef.current) return;
      if (tries++ > 60) return;               // ~15s, then stop quietly
      try {
        void wv.executeJavaScript("1")
          .then(() => setReady(true))
          .catch(() => { catchUpTimer = setTimeout(catchUp, 250); });
      } catch {
        catchUpTimer = setTimeout(catchUp, 250);
      }
    };
    catchUpTimer = setTimeout(catchUp, 200);

    wv.addEventListener("dom-ready", onDomReady);
    wv.addEventListener("did-start-loading", onStart);
    wv.addEventListener("did-stop-loading", onStop);
    wv.addEventListener("did-navigate", onNav as EventListener);
    wv.addEventListener("did-navigate-in-page", onNav as EventListener);
    wv.addEventListener("page-title-updated", onTitle as EventListener);
    wv.addEventListener("console-message", onMsg as EventListener);
    wv.addEventListener("did-fail-load", onFail as EventListener);

    return () => {
      if (catchUpTimer) clearTimeout(catchUpTimer);
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", onStop);
      wv.removeEventListener("did-navigate", onNav as EventListener);
      wv.removeEventListener("did-navigate-in-page", onNav as EventListener);
      wv.removeEventListener("page-title-updated", onTitle as EventListener);
      wv.removeEventListener("console-message", onMsg as EventListener);
      wv.removeEventListener("did-fail-load", onFail as EventListener);
      register(tab.id, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  // Recording follows the active tab: switch tabs mid-run and the new page keeps
  // logging, while the one you left stops.
  useEffect(() => {
    if (!guestReady) return;
    run(active && recording ? recorderJs(lang) : RECORDER_TEARDOWN_JS);
  }, [active, recording, lang, guestReady, run]);

  useEffect(() => {
    if (!guestReady) return;
    run(active && mode !== "off"
      ? annotateJs(mode as "element" | "region", scaleRef.current)
      : ANNOTATE_TEARDOWN_JS);
  }, [active, mode, guestReady, run]);

  // Live scale updates — no re-injection, so the pins survive a resize/rotate.
  // Guarded by `window.__rttA` so it is a no-op when the overlay is not up.
  useEffect(() => {
    if (!guestReady || !active || mode === "off") return;
    run(`window.__rttA && window.__rttA.setScale(${frameScale > 0 ? 1 / frameScale : 1})`);
  }, [frameScale, active, mode, guestReady, run]);

  return (
    <webview
      ref={ref as unknown as React.Ref<HTMLElement>}
      src={initialUrl}
      partition="persist:rtt"
      allowpopups
      className={active && mode !== "off" ? "crosshair" : ""}
      // Hidden rather than unmounted: unmounting would destroy the page and make
      // every tab switch a reload.
      style={{ display: active ? "flex" : "none" }}
    />
  );
}
