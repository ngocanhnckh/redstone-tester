// Programs injected INTO the page under test (the <webview> guest).
//
// Why injection and not a host overlay: an Electron guest paints above all host
// DOM, so a React overlay in the cockpit cannot sit on top of the page. The UI
// therefore has to live inside the guest. A preload-less guest has exactly one
// channel back to the host that arrives verbatim — console messages — so every
// event is a console.log of a marker plus JSON, which the host parses.
//
// Both programs are written as plain strings using concatenation and double
// quotes so nothing inside collides with this file's own template literals, and
// both are re-entrant: injecting twice tears the previous instance down first.

import type { Annotation, Box, Step } from "../../shared/types.js";
import type { Lang } from "../../shared/i18n.js";
import { recorderPhrases } from "../../shared/i18n.js";

export const ANNOT_MARK = "__RTT_A__::";
export const STEP_MARK = "__RTT_S__::";

export type AnnotateMode = "element" | "region" | "off";

/** Payload sent when an element is pinned — the raw material for a DOM reference. */
export interface PinEvent {
  t: "pin";
  id: number;
  selector: string;
  domPath: string;
  tag: string;
  attrs: Record<string, string>;
  text: string;
  styles: Record<string, string>;
  box: Box;
  vw: number;
  vh: number;
  url: string;
}

export type AnnotateEvent =
  | PinEvent
  | { t: "region"; id: number; box: Box; vw: number; vh: number; url: string }
  | { t: "unpin"; id: number }
  | { t: "submit"; url: string; title: string; notes: Array<{ id: number; note: string }> }
  | { t: "exit" }
  /** The overlay could not install — a page CSP, Trusted Types, or a site that
   *  has frozen the DOM APIs the overlay uses. */
  | { t: "err"; m: string };

// ---------------------------------------------------------------------------
// Annotation overlay
// ---------------------------------------------------------------------------

const ANNOTATE = `(() => { try {
  var MARK = "__MARK__";
  var MODE = "__MODE__";
  if (window.__rttA) { try { window.__rttA.teardown(); } catch (e) {} }

  var ACCENT = "#E54D2E";
  var INK = "#1E1813";
  var nodes = [];
  var pins = [];
  var nextId = Number(window.__rttNextId || 1);

  // The guest is rendered inside the cockpit's device frame, which the host
  // shrinks with a CSS transform when the emulated device is wider than the
  // stage (an iPad on a small window, any desktop preset). That shrink applies
  // to everything the guest paints — including this dock, whose 12px text then
  // renders at 7-8px and is unreadable. The markers must ride the shrink so they
  // stay aligned to the page; the dock is chrome, so it counter-scales by the
  // inverse to hold a natural, readable size. invScale is 1/frameScale, pushed
  // in at injection and kept live by the host via __rttA.setScale.
  var invScale = Number("__INVSCALE__") || 1;

  function mk(tag, css) {
    var n = document.createElement(tag);
    n.setAttribute("data-rtt", "1");
    if (css) n.style.cssText = css;
    nodes.push(n);
    (document.documentElement || document.body).appendChild(n);
    return n;
  }
  function isOurs(el) { return !!(el && el.closest && el.closest("[data-rtt]")); }
  function signal(o) { try { console.log(MARK + JSON.stringify(o)); } catch (e) {} }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // ---- element identity ---------------------------------------------------
  function cssEsc(s) {
    try { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&"); }
    catch (e) { return String(s); }
  }
  // Prefer identifiers a developer can act on: id, then test hooks, then a
  // structural path. A path is only worth emitting if it actually resolves.
  function selectorFor(el) {
    if (el.id && document.querySelectorAll("#" + cssEsc(el.id)).length === 1) return "#" + cssEsc(el.id);
    var hooks = ["data-testid", "data-test", "data-cy", "data-qa", "name"];
    for (var h = 0; h < hooks.length; h++) {
      var v = el.getAttribute && el.getAttribute(hooks[h]);
      if (v) {
        var sel = el.nodeName.toLowerCase() + "[" + hooks[h] + "=\\"" + v + "\\"]";
        try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
      }
    }
    var parts = [], cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 6) {
      var seg = cur.nodeName.toLowerCase();
      if (cur.id && document.querySelectorAll("#" + cssEsc(cur.id)).length === 1) { parts.unshift("#" + cssEsc(cur.id)); break; }
      var cls = ((cur.getAttribute && cur.getAttribute("class")) || "").trim().split(/\\s+/).filter(Boolean)[0];
      if (cls && !/^[0-9]/.test(cls)) seg += "." + cssEsc(cls);
      var p = cur.parentElement;
      if (p) {
        var same = Array.prototype.filter.call(p.children, function (c) { return c.nodeName === cur.nodeName; });
        if (same.length > 1) seg += ":nth-of-type(" + (Array.prototype.indexOf.call(p.children, cur) + 1) + ")";
      }
      parts.unshift(seg);
      cur = p;
    }
    return parts.join(" > ");
  }
  function domPathFor(el) {
    var parts = [], cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 8) {
      var seg = cur.nodeName.toLowerCase();
      var cls = ((cur.getAttribute && cur.getAttribute("class")) || "").trim().split(/\\s+/).filter(Boolean)[0];
      if (cls) seg += "." + cls;
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }
  // Only attributes that help a developer locate or reason about the node —
  // dumping every attribute buries the signal (and can leak tokens in URLs).
  function attrsFor(el) {
    var keep = ["id", "class", "name", "type", "role", "href", "src", "alt", "title", "placeholder",
                "value", "disabled", "aria-label", "aria-invalid", "data-testid", "data-test"];
    var out = {};
    for (var i = 0; i < keep.length; i++) {
      var v = el.getAttribute && el.getAttribute(keep[i]);
      if (v !== null && v !== undefined && v !== "") out[keep[i]] = String(v).slice(0, 160);
    }
    return out;
  }
  // The styles that actually explain visual bugs: colour, type, box, layout.
  function stylesFor(el) {
    var out = {};
    try {
      var cs = getComputedStyle(el);
      var keys = ["color", "background-color", "font-size", "font-weight", "display",
                  "visibility", "opacity", "overflow", "position", "z-index", "border-color"];
      for (var i = 0; i < keys.length; i++) {
        var v = cs.getPropertyValue(keys[i]);
        if (v) out[keys[i]] = v.trim();
      }
      var r = el.getBoundingClientRect();
      out["size"] = Math.round(r.width) + "x" + Math.round(r.height) + "px";
    } catch (e) {}
    return out;
  }
  function textFor(el) {
    var t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    if (t) return t.slice(0, 300);
    return (el.outerHTML || "").replace(/\\s+/g, " ").trim().slice(0, 200);
  }
  function boxFor(el) { var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  function vp() { return { vw: window.innerWidth, vh: window.innerHeight }; }

  // ---- teardown -----------------------------------------------------------
  var onMove = function () {}, onClick = function () {}, onKey = function () {},
      onDown = function () {}, onUp = function () {}, onScroll = function () {};
  function teardown() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll, true);
    for (var i = 0; i < nodes.length; i++) { try { nodes[i].remove(); } catch (e) {} }
    nodes = []; pins = [];
    window.__rttNextId = nextId;
    try { delete window.__rttA; } catch (e) { window.__rttA = null; }
  }
  window.__rttA = {
    mode: MODE, teardown: teardown, status: function () {},
    count: function () { return pins.length; },
    // The frame scale changes after the overlay is up — resize the window,
    // rotate the device, pick another preset — so the host updates it live.
    setScale: function (s) { invScale = Number(s) || 1; place(); },
  };

  onKey = function (e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); signal({ t: "exit" }); teardown(); }
  };
  document.addEventListener("keydown", onKey, true);

  // ---- the dock (shared by both modes) ------------------------------------
  var dock = mk("div", "position:fixed;right:16px;bottom:16px;z-index:2147483646;width:320px;max-height:64vh;overflow:auto;" +
    "background:" + INK + "f2;color:#F4F1E9;font:12px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif;" +
    "border:1px solid #ffffff26;border-radius:14px;box-shadow:0 24px 60px #000b;padding:12px;");
  dock.innerHTML =
    '<div data-drag style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;cursor:move;user-select:none">' +
      '<b style="font-size:12.5px;letter-spacing:.02em">' + (MODE === "region" ? "◲  Region capture" : "◎  Highlight defects") + '</b>' +
      '<span style="opacity:.55;font-size:10.5px">Esc to exit</span></div>' +
    '<div data-list></div>' +
    '<div data-empty style="opacity:.6;padding:8px 2px;line-height:1.5">' +
      (MODE === "region" ? "Drag a box around what looks wrong." : "Click any element that looks wrong. Add a note for each.") +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button data-send style="flex:1;background:' + ACCENT + ';color:#fff;border:0;border-radius:9px;padding:8px 10px;font-weight:700;font-size:12px;cursor:pointer">Write ticket (0)</button>' +
      '<button data-cancel style="background:#ffffff1a;color:#F4F1E9;border:0;border-radius:9px;padding:8px 10px;cursor:pointer">Cancel</button>' +
    '</div>';
  var listEl = dock.querySelector("[data-list]");
  var emptyEl = dock.querySelector("[data-empty]");
  var sendBtn = dock.querySelector("[data-send]");
  dock.querySelector("[data-cancel]").addEventListener("click", function () { signal({ t: "exit" }); teardown(); });

  // Counter-scale the dock and keep it pinned bottom-right. Scaling grows the box
  // toward the bottom-right, so anchoring by top/left with a top-left origin keeps
  // the visible top-left corner exactly where we put it — which is what makes the
  // drag maths below stay correct under a transform (getBoundingClientRect of a
  // top-left-origin scaled box has the same top-left as its layout box). While
  // corner-docked, we recompute the corner as the size or viewport changes; once
  // the tester drags it, it holds wherever they left it.
  var docked = true;
  function place() {
    dock.style.transformOrigin = "top left";
    dock.style.transform = invScale === 1 ? "none" : "scale(" + invScale + ")";
    if (!docked) return;
    var w = dock.offsetWidth * invScale, h = dock.offsetHeight * invScale;
    dock.style.right = "auto"; dock.style.bottom = "auto";
    dock.style.left = Math.max(8, window.innerWidth - w - 16) + "px";
    dock.style.top = Math.max(8, window.innerHeight - h - 16) + "px";
  }

  // Drag by the header — the dock must never be the thing blocking the defect.
  var drag = null;
  function dragMove(e) {
    if (!drag) return;
    // Clamp against the SCALED footprint, not the layout box, or the dock rides
    // partly off-screen at the edges when counter-scaled up.
    var w = dock.offsetWidth * invScale, h = dock.offsetHeight * invScale;
    var x = Math.max(0, Math.min(window.innerWidth - w, e.clientX - drag.dx));
    var y = Math.max(0, Math.min(window.innerHeight - h, e.clientY - drag.dy));
    dock.style.left = x + "px"; dock.style.top = y + "px";
  }
  function dragUp() { drag = null; document.removeEventListener("mousemove", dragMove, true); document.removeEventListener("mouseup", dragUp, true); }
  dock.querySelector("[data-drag]").addEventListener("mousedown", function (e) {
    e.preventDefault(); e.stopPropagation();
    docked = false;
    var r = dock.getBoundingClientRect();
    dock.style.right = "auto"; dock.style.bottom = "auto";
    dock.style.left = r.left + "px"; dock.style.top = r.top + "px";
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    document.addEventListener("mousemove", dragMove, true);
    document.addEventListener("mouseup", dragUp, true);
  });

  function renderList() {
    emptyEl.style.display = pins.length ? "none" : "block";
    sendBtn.textContent = "Write ticket (" + pins.length + ")";
    sendBtn.style.opacity = pins.length ? "1" : ".55";
    listEl.innerHTML = "";
    pins.forEach(function (p) {
      var row = document.createElement("div");
      row.setAttribute("data-rtt", "1");
      row.style.cssText = "border-top:1px solid #ffffff14;padding:9px 0";
      var top = document.createElement("div");
      top.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:5px";
      top.innerHTML =
        '<span style="background:' + ACCENT + ';color:#fff;border-radius:999px;min-width:17px;height:17px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800">' + p.id + '</span>' +
        '<code style="font-size:10.5px;opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-family:ui-monospace,monospace">' + esc(p.label) + '</code>' +
        '<button style="background:none;border:0;color:#F4F1E9;opacity:.55;cursor:pointer;font-size:13px;line-height:1">✕</button>';
      top.querySelector("button").addEventListener("click", function () { removePin(p.id); });
      var inp = document.createElement("input");
      inp.setAttribute("data-rtt", "1");
      inp.placeholder = "What is wrong here?";
      inp.value = p.note || "";
      inp.style.cssText = "width:100%;box-sizing:border-box;background:#00000040;border:1px solid #ffffff1f;color:#F4F1E9;border-radius:8px;padding:6px 8px;font:12px inherit;outline:none";
      inp.addEventListener("focus", function () { inp.style.borderColor = ACCENT; });
      inp.addEventListener("blur", function () { inp.style.borderColor = "#ffffff1f"; });
      inp.addEventListener("input", function () { p.note = inp.value; });
      row.appendChild(top); row.appendChild(inp);
      listEl.appendChild(row);
    });
    // The dock's height just changed; if it is corner-docked, re-pin it so a
    // growing list does not push its footer off the bottom of the viewport.
    place();
  }
  function removePin(id) {
    var i = -1;
    for (var k = 0; k < pins.length; k++) if (pins[k].id === id) i = k;
    if (i < 0) return;
    try { pins[i].outline && pins[i].outline.remove(); pins[i].badge && pins[i].badge.remove(); } catch (e) {}
    pins.splice(i, 1); renderList(); signal({ t: "unpin", id: id });
  }
  sendBtn.addEventListener("click", function () {
    if (!pins.length) return;
    var notes = pins.map(function (p) { return { id: p.id, note: p.note || "" }; });
    signal({ t: "submit", url: location.href, title: document.title, notes: notes });
    teardown();
  });

  // Reposition outlines at frame cadence — scroll/resize fire in bursts and
  // recomputing rects on every raw event pegs the compositor.
  var repoRaf = 0;
  onScroll = function () {
    if (repoRaf) return;
    repoRaf = requestAnimationFrame(function () {
      repoRaf = 0;
      // A window resize moves the bottom-right corner the dock is pinned to.
      place();
      pins.forEach(function (p) {
        if (!p.el || !p.el.isConnected || !p.outline) return;
        var r = p.el.getBoundingClientRect();
        p.outline.style.left = r.left + "px"; p.outline.style.top = r.top + "px";
        p.outline.style.width = r.width + "px"; p.outline.style.height = r.height + "px";
        p.badge.style.left = r.left + "px"; p.badge.style.top = r.top + "px";
      });
    });
  };
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll, true);

  function addMarker(id, box, el) {
    var outline = mk("div", "position:fixed;z-index:2147483641;pointer-events:none;border:2px solid " + ACCENT + ";border-radius:3px;box-shadow:0 0 0 9999px #0000,0 6px 20px " + ACCENT + "55;" +
      "left:" + box.x + "px;top:" + box.y + "px;width:" + box.w + "px;height:" + box.h + "px;");
    var badge = mk("div", "position:fixed;z-index:2147483642;pointer-events:none;transform:translate(-5px,-11px);background:" + ACCENT + ";color:#fff;" +
      "font:800 10px ui-sans-serif,system-ui;border-radius:999px;min-width:17px;height:17px;display:flex;align-items:center;justify-content:center;padding:0 4px;" +
      "left:" + box.x + "px;top:" + box.y + "px;");
    badge.textContent = String(id);
    return { outline: outline, badge: badge };
  }

  // =========================================================================
  if (MODE === "element") {
    // Solid fill, no CSS transition: a highlight that chases the cursor with a
    // transition forces continuous compositor repaints on heavy pages.
    var hover = mk("div", "position:fixed;z-index:2147483640;pointer-events:none;border:2px solid " + ACCENT + ";background:" + ACCENT + "1f;border-radius:3px;display:none;");
    var tag = mk("div", "position:fixed;z-index:2147483643;pointer-events:none;display:none;background:" + INK + "f2;color:#F4F1E9;border:1px solid #ffffff26;" +
      "font:11px/1 ui-monospace,monospace;padding:4px 7px;border-radius:6px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis");

    var moveRaf = 0, lastXY = null;
    onMove = function (e) {
      lastXY = { x: e.clientX, y: e.clientY };
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(function () {
        moveRaf = 0;
        if (!lastXY) return;
        var el = document.elementFromPoint(lastXY.x, lastXY.y);
        if (!el || isOurs(el)) { hover.style.display = "none"; tag.style.display = "none"; return; }
        var r = el.getBoundingClientRect();
        hover.style.display = "block";
        hover.style.left = r.left + "px"; hover.style.top = r.top + "px";
        hover.style.width = r.width + "px"; hover.style.height = r.height + "px";
        tag.style.display = "block";
        tag.textContent = el.nodeName.toLowerCase() + (el.id ? "#" + el.id : "") + "  ·  " + Math.round(r.width) + "×" + Math.round(r.height);
        var ty = r.top - 22 < 4 ? r.bottom + 6 : r.top - 22;
        tag.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 240)) + "px";
        tag.style.top = ty + "px";
      });
    };
    onClick = function (e) {
      if (isOurs(e.target)) return;
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isOurs(el)) return;
      e.preventDefault(); e.stopPropagation();
      var id = nextId++;
      var box = boxFor(el);
      var m = addMarker(id, box, el);
      var sel = selectorFor(el);
      pins.push({ id: id, el: el, note: "", outline: m.outline, badge: m.badge, label: sel });
      var v = vp();
      signal({
        t: "pin", id: id, selector: sel, domPath: domPathFor(el), tag: el.nodeName.toLowerCase(),
        attrs: attrsFor(el), text: textFor(el), styles: stylesFor(el),
        box: box, vw: v.vw, vh: v.vh, url: location.href
      });
      renderList();
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
  }

  // =========================================================================
  if (MODE === "region") {
    var surface = mk("div", "position:fixed;inset:0;z-index:2147483639;cursor:crosshair;background:#0000;");
    var live = mk("div", "position:fixed;z-index:2147483640;pointer-events:none;border:2px dashed " + ACCENT + ";background:" + ACCENT + "14;display:none;");
    var start = null, cur = null;
    function rectBox() {
      var x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y);
      return { x: x, y: y, w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) };
    }
    function draw() { var b = rectBox(); live.style.left = b.x + "px"; live.style.top = b.y + "px"; live.style.width = b.w + "px"; live.style.height = b.h + "px"; }
    surface.addEventListener("mousedown", function (e) { start = { x: e.clientX, y: e.clientY }; cur = start; live.style.display = "block"; draw(); }, true);
    surface.addEventListener("mousemove", function (e) { if (!start) return; cur = { x: e.clientX, y: e.clientY }; draw(); }, true);
    surface.addEventListener("mouseup", function (e) {
      if (!start) return;
      cur = { x: e.clientX, y: e.clientY };
      var b = rectBox();
      start = null; live.style.display = "none";
      if (b.w < 8 || b.h < 8) return;
      var id = nextId++;
      addMarker(id, b, null);
      pins.push({ id: id, el: null, note: "", outline: null, badge: null, label: "region " + Math.round(b.w) + "×" + Math.round(b.h) });
      var v = vp();
      signal({ t: "region", id: id, box: b, vw: v.vw, vh: v.vh, url: location.href });
      renderList();
    }, true);
  }

  renderList();
} catch (e) {
  // A partial install is worse than none: window.__rttA exists, so re-injecting
  // just tears down and fails again, and the tester sees a mode that is "on" but
  // does nothing. Clear the handle and tell the host why.
  try { delete window.__rttA; } catch (e2) { window.__rttA = null; }
  // Use the MARK variable, not another "__MARK__" literal: the substitution
  // below is a string replace, which only ever replaces the FIRST occurrence.
  try { console.log(MARK + JSON.stringify({ t: "err", m: String((e && e.message) || e) })); } catch (e3) {}
} })();`;

// replaceAll, not replace: a string `replace` substitutes only the FIRST match,
// so a second `__MARK__` in the program would silently ship the literal and its
// messages would never be recognised by the host.
//
// `frameScale` is the CSS-transform scale the host applies to the device frame
// (≤ 1). The overlay counter-scales its dock by the inverse so it stays readable
// no matter how far the emulated device is shrunk. Rounded so the injected
// literal is a short, exact number rather than 1.3333333333333333.
export function annotateJs(mode: Exclude<AnnotateMode, "off">, frameScale = 1): string {
  const inv = frameScale > 0 ? Math.round((1 / frameScale) * 1000) / 1000 : 1;
  return ANNOTATE
    .replaceAll("__MODE__", mode)
    .replaceAll("__MARK__", ANNOT_MARK)
    .replaceAll("__INVSCALE__", String(inv));
}

export const ANNOTATE_TEARDOWN_JS =
  `(() => { try { if (window.__rttA) window.__rttA.teardown(); } catch (e) {} })();`;

// ---------------------------------------------------------------------------
// Step recorder
// ---------------------------------------------------------------------------

/**
 * Records what the tester actually did, so "steps to reproduce" is observed
 * rather than remembered. Runs on every page from first load; the cost of
 * recording is three passive listeners.
 *
 * Values are labelled, never captured verbatim for password/secret fields — a
 * bug report is a shared artefact and must not carry credentials into Jira.
 */
const RECORDER = `(() => {
  var MARK = "__MARK__";
  var L = __PHRASES__;
  if (window.__rttR) return;

  function signal(kind, text) {
    try { console.log(MARK + JSON.stringify({ t: Date.now(), kind: kind, text: text, url: location.href })); } catch (e) {}
  }
  function isOurs(el) { return !!(el && el.closest && el.closest("[data-rtt]")); }

  // While an annotation overlay is up, the tester is marking defects, not
  // exercising the product — a click that pins the price is not "click the
  // price". The recorder is injected first and both listen on document in the
  // capture phase, so without this guard registration order lets the pin click
  // through as a step before the overlay's stopPropagation ever runs.
  function annotating() { return !!window.__rttA; }

  // How a human would name the thing they clicked: its accessible label first,
  // its visible text next, falling back to a structural hint.
  function label(el) {
    if (!el || el.nodeType !== 1) return "element";
    var aria = el.getAttribute("aria-label");
    if (aria) return "\\"" + aria.trim().slice(0, 60) + "\\"";
    var txt = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    if (txt && txt.length <= 60) return "\\"" + txt + "\\"";
    if (txt) return "\\"" + txt.slice(0, 57) + "…\\"";
    var ph = el.getAttribute("placeholder");
    if (ph) return L.fieldOf.replace("%s", ph.trim().slice(0, 40));
    var nm = el.getAttribute("name") || el.getAttribute("id");
    if (nm) return "\\"" + nm + "\\"";
    var alt = el.getAttribute("alt") || el.getAttribute("title");
    if (alt) return "\\"" + alt.trim().slice(0, 40) + "\\"";
    return L.theTag.replace("%s", el.nodeName.toLowerCase());
  }
  function role(el) {
    var t = el.nodeName.toLowerCase();
    var ty = (el.getAttribute("type") || "").toLowerCase();
    if (t === "a") return L.roles.link;
    if (t === "button" || ty === "submit" || ty === "button" || el.getAttribute("role") === "button") return L.roles.button;
    if (t === "input" || t === "textarea" || t === "select") return L.roles.field;
    return t;
  }
  function sensitive(el) {
    var ty = (el.getAttribute("type") || "").toLowerCase();
    var hint = ((el.getAttribute("name") || "") + " " + (el.getAttribute("id") || "") + " " + (el.getAttribute("autocomplete") || "")).toLowerCase();
    return ty === "password" || /pass|secret|token|otp|cvv|card|ssn/.test(hint);
  }

  // Interactive ancestors matter more than the exact pixel target — a click on a
  // <span> inside a <button> is, to a reader, a click on the button.
  function actionable(el) {
    var cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && depth++ < 5) {
      var t = cur.nodeName.toLowerCase();
      if (t === "a" || t === "button" || t === "input" || t === "select" || t === "textarea" ||
          cur.getAttribute("role") === "button" || cur.getAttribute("onclick") || cur.tabIndex >= 0) return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  function onClick(e) {
    if (annotating() || isOurs(e.target)) return;
    var el = actionable(e.target);
    if (!el || el === document.body || el === document.documentElement) return;
    signal("click", L.click + " " + role(el) + " " + label(el));
  }

  // Typing: report once per field when focus leaves, not per keystroke.
  function onChange(e) {
    var el = e.target;
    if (annotating() || !el || isOurs(el) || el.nodeType !== 1) return;
    var t = el.nodeName.toLowerCase();
    if (t !== "input" && t !== "textarea" && t !== "select") return;
    var ty = (el.getAttribute("type") || "").toLowerCase();
    if (ty === "checkbox" || ty === "radio") {
      signal("input", (el.checked ? L.check : L.uncheck) + " " + label(el));
      return;
    }
    var v = sensitive(el) ? L.redacted : String(el.value == null ? "" : el.value).slice(0, 60);
    signal("input", L.enter + " \\"" + v + "\\" " + L.into + " " + label(el));
  }

  function onSubmit(e) {
    if (annotating() || isOurs(e.target)) return;
    signal("submit", L.submit + " " + label(e.target));
  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("submit", onSubmit, true);

  // A handle so recording can be stopped — without it the listeners outlive any
  // attempt to pause, and a re-injection would double every step.
  window.__rttR = { teardown: function () {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("submit", onSubmit, true);
    try { delete window.__rttR; } catch (e) { window.__rttR = null; }
  } };

  signal("navigate", L.open + " " + location.href);
})();`;

/** The recorder writes its steps in `lang`. Recording happens long before any
 *  model call, so the phrasing has to ship with the program rather than be
 *  translated later. */
export function recorderJs(lang: Lang = "English"): string {
  return RECORDER
    .replaceAll("__MARK__", STEP_MARK)
    .replaceAll("__PHRASES__", JSON.stringify(recorderPhrases(lang)));
}

/** Stop recording and detach the listeners. */
export const RECORDER_TEARDOWN_JS =
  `(() => { try { if (window.__rttR) window.__rttR.teardown(); } catch (e) {} })();`;

// ---------------------------------------------------------------------------
// Host-side parsing
// ---------------------------------------------------------------------------

/** Parse one console line from the guest, or null if it isn't ours. */
export function parseAnnotate(msg: string): AnnotateEvent | null {
  if (!msg.startsWith(ANNOT_MARK)) return null;
  try { return JSON.parse(msg.slice(ANNOT_MARK.length)) as AnnotateEvent; } catch { return null; }
}

export function parseStep(msg: string): Step | null {
  if (!msg.startsWith(STEP_MARK)) return null;
  try { return JSON.parse(msg.slice(STEP_MARK.length)) as Step; } catch { return null; }
}

/** Turn a pin event into the Annotation the ticket model stores. */
export function pinToAnnotation(e: PinEvent): Annotation {
  return {
    id: e.id, kind: "element", note: "",
    selector: e.selector, domPath: e.domPath, tag: e.tag, attrs: e.attrs,
    text: e.text, styles: e.styles, box: e.box, vw: e.vw, vh: e.vh, url: e.url,
  };
}
