// @vitest-environment jsdom
//
// The retest bar is where a verdict on someone else's bug gets recorded, and the
// two ways it can be wrong are both silent: closing a defect that still
// reproduces, and reporting a pass that never reached Jira. Neither shows up in
// a typecheck, so this drives the real component against a stubbed Jira.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RetestBar from "./RetestBar.js";
import { useStore } from "./store.js";
import { DEFAULT_SETTINGS } from "../../shared/types.js";
import type { Annotation, JiraTransition } from "../../shared/types.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ok = <T,>(data: T) => ({ ok: true as const, data });

const TRANSITIONS: JiraTransition[] = [
  { id: "11", name: "Reopen", to: "Reopened", toCategory: "new" },
  { id: "21", name: "Start work", to: "In Progress", toCategory: "indeterminate" },
  { id: "31", name: "Close Issue", to: "Done", toCategory: "done" },
];

const PLAN = {
  url: "https://shop.test/cart",
  steps: ["Open https://shop.test/", "Add an item", "Open the cart"],
  expected: "The total shows the sum of line items.",
  current: "The total shows $NaN.",
  device: "iPhone 15 / 14 Pro — 393×852 @3x (portrait)",
  viewport: { w: 393, h: 852 },
};

const CROP: Annotation = {
  id: 1, kind: "element", note: "still NaN", selector: "#total",
  box: { x: 0, y: 0, w: 80, h: 20 }, vw: 393, vh: 852,
  url: "https://shop.test/cart", shot: "data:image/png;base64,AAA",
};

let host: HTMLDivElement;
let root: Root;
let jira: Record<string, ReturnType<typeof vi.fn>>;

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function text(): string {
  return host.textContent ?? "";
}

function click(match: string | RegExp): void {
  const el = [...host.querySelectorAll("button")].find((b) =>
    typeof match === "string" ? b.textContent?.includes(match) : match.test(b.textContent ?? ""));
  if (!el) throw new Error(`No button matching ${String(match)} in: ${text()}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** The single argument the retest IPC was called with. */
function posted(): Record<string, unknown> {
  expect(jira.retest).toHaveBeenCalledTimes(1);
  return jira.retest.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  jira = {
    transitions: vi.fn().mockResolvedValue(ok(TRANSITIONS)),
    retest: vi.fn().mockResolvedValue(ok({
      comment: { id: "c1", author: "Anh Nguyen", body: "", created: new Date().toISOString() },
      failedAttachments: [],
      moved: true,
    })),
  };
  (window as unknown as { tester: unknown }).tester = { jira };

  useStore.setState({
    settings: DEFAULT_SETTINGS,
    annotations: [],
    steps: [],
    consoleErrors: [],
    deviceId: "iphone-15",
    orientation: "portrait",
    viewport: { w: 393, h: 852 },
    url: "https://shop.test/cart",
    retestOpen: true,
    retest: {
      key: "RTT-7",
      summary: "Price renders as NaN on the cart",
      issueUrl: "https://jira.example.com/browse/RTT-7",
      plan: PLAN,
      done: PLAN.steps.map(() => false),
    },
  });

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore.setState({ retest: null, annotations: [] });
});

const mount = async (): Promise<void> => {
  await act(async () => { root.render(<RetestBar />); });
  await settle();
};

describe("what the ticket said", () => {
  it("stays out of the way when nothing is being retested", async () => {
    useStore.setState({ retest: null });
    await mount();
    expect(text()).toBe("");
  });

  it("shows the issue, its steps and both behaviours", async () => {
    await mount();
    const out = text();
    expect(out).toContain("RTT-7");
    expect(out).toContain("Price renders as NaN on the cart");
    expect(out).toContain("Open the cart");
    expect(out).toContain("The total shows the sum of line items.");
    expect(out).toContain("The total shows $NaN.");
    // The device it was found on — retesting a responsive bug at the wrong
    // width would mark a live defect as fixed.
    expect(out).toContain("iPhone 15 / 14 Pro — 393×852 @3x (portrait)");
  });

  it("tracks how far through the steps the tester is", async () => {
    await mount();
    expect(text()).toContain("0/3 steps");
    await act(async () => { click("Add an item"); });
    expect(text()).toContain("1/3 steps");
  });

  it("says so when the ticket gives nothing to drive", async () => {
    useStore.setState({
      retest: {
        key: "RTT-9", summary: "Looks wrong", issueUrl: "",
        plan: { url: "", steps: [], expected: "", current: "", device: "", viewport: null },
        done: [],
      },
    });
    await mount();
    expect(text()).toContain("names no URL and no steps");
  });
});

describe("recording a pass", () => {
  it("posts the verdict and suggests closing the issue", async () => {
    await mount();
    await act(async () => { click("Passes"); });
    await act(async () => { click("Comment on"); });
    await settle();

    const call = posted();
    expect(call.issueKey).toBe("RTT-7");
    expect(call.transitionId).toBe("31"); // the `done` transition
    expect(String(call.markdown)).toContain("Retest passed");
    // Where it was retested is part of the verdict, not decoration.
    expect(String(call.markdown)).toContain("iPhone 15 / 14 Pro");
    expect(String(call.markdown)).toContain("https://shop.test/cart");
  });

  it("carries the ticket's own steps when the tester recorded none", async () => {
    await mount();
    await act(async () => { click("Passes"); });
    await act(async () => { click("Comment on"); });
    await settle();
    expect(String(posted().markdown)).toContain("1. Open https://shop.test/");
  });

  it("prefers a recorded run over the ticket's steps", async () => {
    // What actually happened this time beats what the ticket said to do — the
    // flow may have changed since it was filed.
    useStore.setState({
      steps: [{ t: 1, kind: "navigate", text: "Open https://shop.test/cart", url: "https://shop.test/cart" }],
    });
    await mount();
    await act(async () => { click("Passes"); });
    await act(async () => { click("Comment on"); });
    await settle();
    const md = String(posted().markdown);
    expect(md).toContain("1. Open https://shop.test/cart");
    expect(md).not.toContain("Add an item");
  });

  it("attaches nothing — a screenshot of a working page proves nothing", async () => {
    useStore.setState({ annotations: [CROP] });
    await mount();
    await act(async () => { click("Passes"); });
    await act(async () => { click("Comment on"); });
    await settle();
    expect(posted().attachments).toEqual([]);
  });

  it("clears the retest and confirms, rather than leaving it looking unfinished", async () => {
    await mount();
    await act(async () => { click("Passes"); });
    await act(async () => { click("Comment on"); });
    await settle();
    expect(useStore.getState().retest).toBeNull();
    expect(text()).toContain("Retest recorded");
    expect(text()).toContain("passed");
  });
});

describe("recording a failure", () => {
  it("never suggests closing a bug that still reproduces", async () => {
    await mount();
    await act(async () => { click("Still broken"); });
    await act(async () => { click("Comment on"); });
    await settle();
    expect(posted().transitionId).not.toBe("31");
    expect(posted().transitionId).toBe("11"); // Reopen
    expect(String(posted().markdown)).toContain("Retest failed");
  });

  it("attaches the fresh crops, named apart from the original filing's", async () => {
    useStore.setState({ annotations: [CROP] });
    await mount();
    await act(async () => { click("Still broken"); });
    await act(async () => { click("Comment on"); });
    await settle();
    expect(posted().attachments).toEqual([
      { name: "retest-element-1.png", dataUrl: "data:image/png;base64,AAA" },
    ]);
    expect(String(posted().markdown)).toContain("retest-element-1.png");
  });
});

describe("when Jira only half cooperates", () => {
  it("keeps the verdict on screen instead of losing it to an error", async () => {
    jira.retest.mockResolvedValue({ ok: false, error: "403 Forbidden" });
    await mount();
    await act(async () => { click("Passes"); });
    await act(async () => { click("Comment on"); });
    await settle();
    expect(text()).toContain("403 Forbidden");
    // Still retesting, still composed — the tester can retry, not retype.
    expect(useStore.getState().retest).not.toBeNull();
  });

  it("says the status did not move, without claiming the retest failed", async () => {
    jira.retest.mockResolvedValue(ok({
      comment: { id: "c1", author: "A", body: "", created: "" },
      failedAttachments: ["retest-element-1.png"],
      moved: false,
      moveError: "Transition is not valid",
    }));
    await mount();
    await act(async () => { click("Passes"); });
    await act(async () => { click("Comment on"); });
    await settle();
    const out = text();
    expect(out).toContain("Retest recorded");
    expect(out).toContain("status not moved");
    expect(out).toContain("1 screenshot(s) did not upload");
  });

  it("still records a verdict when the workflow offers no moves at all", async () => {
    jira.transitions.mockResolvedValue({ ok: false, error: "403 Forbidden" });
    await mount();
    await act(async () => { click("Passes"); });
    expect(text()).toContain("No status moves available");
    await act(async () => { click("Comment on"); });
    await settle();
    expect(posted().transitionId).toBeUndefined();
  });
});
