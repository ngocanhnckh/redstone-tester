// @vitest-environment jsdom
//
// The guest programs are strings, so the compiler cannot check them. These tests
// run them in jsdom exactly as the webview would, drive real DOM events, and
// assert on the console signals the host parses — the one contract between them.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANNOTATE_TEARDOWN_JS, RECORDER_TEARDOWN_JS, annotateJs, parseAnnotate, parseStep,
  pinToAnnotation, recorderJs,
} from "./guest.js";
import type { PinEvent } from "./guest.js";

/** Capture everything the guest logs, and expose the parsed signals. */
function withConsole() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === "string") lines.push(args[0]);
  });
  return {
    lines,
    annotations: () => lines.map(parseAnnotate).filter(Boolean),
    steps: () => lines.map(parseStep).filter(Boolean),
    restore: () => spy.mockRestore(),
  };
}

/** jsdom has no layout engine: elementFromPoint always returns null and every
 *  rect is zero. Stub just enough that the overlay's hit-testing runs. */
function stubLayout(target: Element): void {
  document.elementFromPoint = (() => target) as typeof document.elementFromPoint;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return { x: 12, y: 34, left: 12, top: 34, width: 100, height: 40, right: 112, bottom: 74, toJSON: () => ({}) } as DOMRect;
  };
}

function run(code: string): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(code)();
}

// jsdom keeps one document across the file, and both programs attach listeners
// to it — so each test has to tear the previous one down properly rather than
// just clearing innerHTML (the overlay appends to documentElement, not body).
beforeEach(() => {
  run(ANNOTATE_TEARDOWN_JS);
  run(RECORDER_TEARDOWN_JS);
  document.body.innerHTML = "";
  document.querySelectorAll("[data-rtt]").forEach((n) => n.remove());
  delete (window as unknown as Record<string, unknown>).__rttNextId;
});

describe("annotation overlay — element mode", () => {
  it("reports a usable DOM reference when an element is clicked", () => {
    document.body.innerHTML = `
      <main><div class="summary"><span id="total" class="summary__total">$NaN</span></div></main>`;
    const target = document.getElementById("total") as HTMLElement;
    stubLayout(target);

    const c = withConsole();
    run(annotateJs("element"));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 20, clientY: 40 }));

    const pin = c.annotations().find((e) => e?.t === "pin") as PinEvent | undefined;
    c.restore();

    expect(pin).toBeDefined();
    expect(pin?.selector).toBe("#total");
    expect(pin?.domPath).toContain("span.summary__total");
    expect(pin?.tag).toBe("span");
    expect(pin?.text).toBe("$NaN");
    expect(pin?.attrs.id).toBe("total");
    expect(pin?.box).toEqual({ x: 12, y: 34, w: 100, h: 40 });
  });

  it("prefers a test hook over a structural path", () => {
    document.body.innerHTML = `<div><button data-testid="checkout">Pay</button></div>`;
    const target = document.querySelector("button") as HTMLElement;
    stubLayout(target);

    const c = withConsole();
    run(annotateJs("element"));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }));
    const pin = c.annotations().find((e) => e?.t === "pin") as PinEvent | undefined;
    c.restore();

    expect(pin?.selector).toBe('button[data-testid="checkout"]');
  });

  it("keeps its own UI out of the report", () => {
    document.body.innerHTML = `<p id="p">text</p>`;
    stubLayout(document.getElementById("p") as HTMLElement);
    const c = withConsole();
    run(annotateJs("element"));

    // Everything the overlay injects is tagged, so a click inside it is ignored.
    const ownNode = document.querySelector("[data-rtt]") as HTMLElement;
    expect(ownNode).toBeTruthy();
    ownNode.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }));
    const pins = c.annotations().filter((e) => e?.t === "pin");
    c.restore();
    expect(pins).toHaveLength(0);
  });

  it("removes every injected node on teardown", () => {
    document.body.innerHTML = `<p id="p">text</p>`;
    stubLayout(document.getElementById("p") as HTMLElement);
    run(annotateJs("element"));
    expect(document.querySelectorAll("[data-rtt]").length).toBeGreaterThan(0);

    run(ANNOTATE_TEARDOWN_JS);
    expect(document.querySelectorAll("[data-rtt]")).toHaveLength(0);
    expect((window as unknown as Record<string, unknown>).__rttA).toBeFalsy();
  });

  it("reports a failed install rather than leaving a dead overlay", () => {
    // A page can refuse the overlay (CSP, Trusted Types, frozen DOM APIs). The
    // handle is set before the UI is built, so a throw part-way through used to
    // leave __rttA in place with nothing on screen: re-injecting then saw the
    // handle, tore it down, and failed again — a mode that is "on" and does
    // nothing, with no diagnostic. Simulate by refusing appended nodes.
    document.body.innerHTML = `<p id="p">text</p>`;
    stubLayout(document.getElementById("p") as HTMLElement);
    const realAppend = Element.prototype.appendChild;
    Element.prototype.appendChild = function () { throw new Error("blocked by page"); };

    const c = withConsole();
    run(annotateJs("element"));
    Element.prototype.appendChild = realAppend;

    const err = c.annotations().find((e) => e?.t === "err");
    c.restore();

    expect(err).toBeDefined();
    expect((err as { m: string }).m).toContain("blocked by page");
    // The handle must be gone, so the next attempt starts clean.
    expect((window as unknown as Record<string, unknown>).__rttA).toBeFalsy();
  });

  it("signals an exit on Escape", () => {
    const c = withConsole();
    run(annotateJs("element"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const exit = c.annotations().find((e) => e?.t === "exit");
    c.restore();
    expect(exit).toBeDefined();
    expect(document.querySelectorAll("[data-rtt]")).toHaveLength(0);
  });

  it("re-injecting replaces the previous overlay instead of stacking one", () => {
    run(annotateJs("element"));
    const first = document.querySelectorAll("[data-rtt]").length;
    run(annotateJs("region"));
    const second = document.querySelectorAll("[data-rtt]").length;
    // A second overlay on top would roughly double the node count.
    expect(second).toBeLessThan(first * 2);
  });
});

describe("step recorder", () => {
  it("names clicks the way a reader would", () => {
    document.body.innerHTML = `<button class="primary">Save changes</button>`;
    const c = withConsole();
    run(recorderJs());
    (document.querySelector("button") as HTMLElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const steps = c.steps();
    c.restore();

    expect(steps.some((s) => s?.kind === "navigate")).toBe(true);
    expect(steps.find((s) => s?.kind === "click")?.text).toBe('Click the button "Save changes"');
  });

  it("attributes a click on inner markup to the control that owns it", () => {
    document.body.innerHTML = `<button><span class="icon"></span><span>Add to cart</span></button>`;
    const c = withConsole();
    run(recorderJs());
    (document.querySelector("span:last-child") as HTMLElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const click = c.steps().find((s) => s?.kind === "click");
    c.restore();
    expect(click?.text).toBe('Click the button "Add to cart"');
  });

  it("records typed values but never a password", () => {
    document.body.innerHTML = `
      <input id="email" placeholder="Email" />
      <input id="pw" type="password" placeholder="Password" />`;
    const c = withConsole();
    run(recorderJs());

    const email = document.getElementById("email") as HTMLInputElement;
    email.value = "qa@acme.io";
    email.dispatchEvent(new Event("change", { bubbles: true }));

    const pw = document.getElementById("pw") as HTMLInputElement;
    pw.value = "hunter2";
    pw.dispatchEvent(new Event("change", { bubbles: true }));

    const inputs = c.steps().filter((s) => s?.kind === "input");
    c.restore();

    expect(inputs[0]?.text).toBe('Enter "qa@acme.io" into the "Email" field');
    expect(inputs[1]?.text).toBe('Enter "(redacted)" into the "Password" field');
    expect(c.lines.join("\n")).not.toContain("hunter2");
  });

  it("redacts by field name too, not only by input type", () => {
    document.body.innerHTML = `<input name="card_number" placeholder="Card" />`;
    const c = withConsole();
    run(recorderJs());
    const el = document.querySelector("input") as HTMLInputElement;
    el.value = "4111111111111111";
    el.dispatchEvent(new Event("change", { bubbles: true }));
    c.restore();
    expect(c.lines.join("\n")).not.toContain("4111111111111111");
  });

  it("does not record highlighting as a test step", () => {
    // The recorder is injected first (at dom-ready) and the overlay later, and
    // both listen on document in the capture phase — so without an explicit
    // guard the recorder sees the pin click before the overlay can swallow it,
    // and "click the price" lands in the steps as something the tester did.
    document.body.innerHTML = `<span id="price">$400</span>`;
    const target = document.getElementById("price") as HTMLElement;
    stubLayout(target);

    const c = withConsole();
    run(recorderJs());
    run(annotateJs("element"));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 20, clientY: 40 }));

    const steps = c.steps().filter((s) => s?.kind === "click");
    const pins = c.annotations().filter((e) => e?.t === "pin");
    c.restore();

    expect(pins).toHaveLength(1);   // the highlight registered
    expect(steps).toHaveLength(0);  // and produced no step
  });

  it("resumes recording once the overlay is torn down", () => {
    document.body.innerHTML = `<button>Save</button>`;
    stubLayout(document.querySelector("button") as HTMLElement);
    const c = withConsole();
    run(recorderJs());
    run(annotateJs("element"));
    run(ANNOTATE_TEARDOWN_JS);
    (document.querySelector("button") as HTMLElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const steps = c.steps().filter((s) => s?.kind === "click");
    c.restore();
    expect(steps).toHaveLength(1);
  });

  it("installs only once per page", () => {
    const c = withConsole();
    run(recorderJs());
    run(recorderJs());
    const navs = c.steps().filter((s) => s?.kind === "navigate");
    c.restore();
    expect(navs).toHaveLength(1);
  });
});

describe("recorder language", () => {
  it("records steps in the ticket language", () => {
    document.body.innerHTML = `
      <button>Lưu</button>
      <input id="email" placeholder="Email" />`;
    const c = withConsole();
    run(recorderJs("Tiếng Việt"));

    (document.querySelector("button") as HTMLElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const email = document.getElementById("email") as HTMLInputElement;
    email.value = "qa@acme.io";
    email.dispatchEvent(new Event("change", { bubbles: true }));

    const steps = c.steps();
    c.restore();

    expect(steps.find((s) => s?.kind === "navigate")?.text).toMatch(/^Mở /);
    expect(steps.find((s) => s?.kind === "click")?.text).toBe('Nhấp vào nút "Lưu"');
    expect(steps.find((s) => s?.kind === "input")?.text).toBe('Nhập "qa@acme.io" vào trường "Email"');
  });

  it("redacts in the chosen language too", () => {
    document.body.innerHTML = `<input type="password" placeholder="Mật khẩu" />`;
    const c = withConsole();
    run(recorderJs("Tiếng Việt"));
    const pw = document.querySelector("input") as HTMLInputElement;
    pw.value = "hunter2";
    pw.dispatchEvent(new Event("change", { bubbles: true }));
    const step = c.steps().find((s) => s?.kind === "input");
    c.restore();
    expect(step?.text).toContain("(đã ẩn)");
    expect(c.lines.join("\n")).not.toContain("hunter2");
  });

  it("falls back to English phrasing for a language it cannot phrase", () => {
    document.body.innerHTML = `<button>Save</button>`;
    const c = withConsole();
    run(recorderJs("日本語"));
    (document.querySelector("button") as HTMLElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const step = c.steps().find((s) => s?.kind === "click");
    c.restore();
    expect(step?.text).toBe('Click the button "Save"');
  });
});

describe("marker substitution", () => {
  it("leaves no unsubstituted placeholder in either program", () => {
    // A string `.replace` only swaps the first match; a second placeholder would
    // ship as a literal and its messages would never reach the host.
    for (const src of [annotateJs("element"), annotateJs("region", 0.5), recorderJs(), recorderJs("Tiếng Việt")]) {
      expect(src).not.toContain("__MARK__");
      expect(src).not.toContain("__MODE__");
      expect(src).not.toContain("__PHRASES__");
      expect(src).not.toContain("__INVSCALE__");
    }
  });

  it("bakes in the inverse of the frame scale, rounded", () => {
    // The dock counter-scales by this, so a 0.75 frame must inject 1.333, not
    // 1.3333333333333333.
    expect(annotateJs("element", 0.75)).toContain("Number(\"1.333\")");
    // No scaling asked for → exactly 1, and the dock's transform stays "none".
    expect(annotateJs("element", 1)).toContain("Number(\"1\")");
  });

  it("never divides by a zero scale", () => {
    expect(annotateJs("element", 0)).toContain("Number(\"1\")");
  });
});

describe("annotation dock scaling", () => {
  it("counter-scales the dock, but not the markers, on a shrunk frame", () => {
    document.body.innerHTML = `<p id="p">text</p>`;
    const target = document.getElementById("p") as HTMLElement;
    stubLayout(target);

    // A half-size frame: the dock must scale UP by 2 to read at natural size.
    run(annotateJs("element", 0.5));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 20, clientY: 40 }));

    const scaled = [...document.querySelectorAll<HTMLElement>("[data-rtt]")]
      .filter((n) => /scale\(2\)/.test(n.style.transform));
    // Exactly one element counter-scales — the dock. The outline and badge that
    // track the clicked element must ride the frame's shrink so they stay
    // aligned, so they must NOT carry an inverse transform.
    expect(scaled).toHaveLength(1);
  });

  it("holds the dock at natural size when the frame is not scaled", () => {
    run(annotateJs("element", 1));
    const anyInverse = [...document.querySelectorAll<HTMLElement>("[data-rtt]")]
      .some((n) => /scale\(/.test(n.style.transform));
    expect(anyInverse).toBe(false);
  });

  it("live setScale re-pins the dock without re-injecting", () => {
    run(annotateJs("element", 1));
    const before = document.querySelectorAll("[data-rtt]").length;

    const api = (window as unknown as { __rttA?: { setScale?: (s: number) => void } }).__rttA;
    expect(typeof api?.setScale).toBe("function");
    api!.setScale!(2);

    const after = document.querySelectorAll("[data-rtt]").length;
    // Same nodes — the overlay was updated in place, not torn down and rebuilt,
    // so any pins the tester had made would survive a resize.
    expect(after).toBe(before);
    const scaled = [...document.querySelectorAll<HTMLElement>("[data-rtt]")]
      .filter((n) => /scale\(2\)/.test(n.style.transform));
    expect(scaled).toHaveLength(1);
  });
});

describe("host-side parsing", () => {
  it("ignores console noise from the page itself", () => {
    expect(parseAnnotate("some app log")).toBeNull();
    expect(parseStep("Warning: something")).toBeNull();
  });

  it("maps a pin event onto the stored annotation", () => {
    const a = pinToAnnotation({
      t: "pin", id: 3, selector: "#x", domPath: "div > #x", tag: "div",
      attrs: {}, text: "hi", styles: { color: "red" },
      box: { x: 0, y: 0, w: 5, h: 5 }, vw: 1280, vh: 800, url: "https://a.test",
    });
    expect(a.kind).toBe("element");
    expect(a.note).toBe("");
    expect(a.selector).toBe("#x");
  });
});
