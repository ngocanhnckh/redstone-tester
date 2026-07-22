// @vitest-environment jsdom
//
// The queue is the one panel that renders live Jira data, so its failure mode is
// a blank sidebar or a crashed renderer — neither of which a typecheck catches.
// These render it for real against a stubbed Jira: list, detail, status move and
// comment, which is the whole loop the tester works in.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Queue from "./Queue.js";
import { useStore } from "./store.js";
import type { JiraIssueDetail, JiraStatus, JiraTransition } from "../../shared/types.js";

// Without this React refuses to batch inside act(), so effects and state
// updates settle in an order the real app would never produce — the tests would
// still pass, but they would not be testing the app's actual behaviour.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ok = <T,>(data: T) => ({ ok: true as const, data });

const STATUSES: JiraStatus[] = [
  { id: "1", name: "Ready for QA", category: "indeterminate" },
  { id: "2", name: "Done", category: "done" },
];

const DETAIL: JiraIssueDetail = {
  key: "RTT-7",
  summary: "Price renders as NaN on the cart",
  status: "Ready for QA",
  statusCategory: "indeterminate",
  issueType: "Bug",
  priority: "High",
  assignee: { id: "anh", displayName: "Anh Nguyen" },
  reporter: { id: "bob", displayName: "Bob Smith" },
  updated: new Date().toISOString(),
  url: "https://jira.example.com/browse/RTT-7",
  description: "h3. Steps\n* open the cart\n* see {{NaN}}",
  labels: ["checkout"],
  created: new Date().toISOString(),
  comments: [
    { id: "c1", author: "Bob Smith", body: "Cannot reproduce on *staging*.", created: new Date().toISOString() },
  ],
  attachments: [
    { id: "a1", filename: "cart.png", mimeType: "image/png", size: 20480, content: "https://jira.example.com/secure/attachment/a1/cart.png" },
  ],
};

const TRANSITIONS: JiraTransition[] = [
  { id: "31", name: "Close Issue", to: "Done", toCategory: "done" },
];

let host: HTMLDivElement;
let root: Root;
let jira: Record<string, ReturnType<typeof vi.fn>>;

/** Let queued promises settle and effects flush, the way a real paint would. */
async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function text(): string {
  return host.textContent ?? "";
}

/** Click the first element whose text matches — how the tester reaches it. */
function click(match: string | RegExp): void {
  const el = [...host.querySelectorAll("button")].find((b) =>
    typeof match === "string" ? b.textContent?.includes(match) : match.test(b.textContent ?? ""));
  if (!el) throw new Error(`No button matching ${String(match)} in: ${text()}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

beforeEach(() => {
  jira = {
    queue: vi.fn().mockResolvedValue(ok({
      issues: [{
        key: "RTT-7",
        summary: "Price renders as NaN on the cart",
        status: "Ready for QA",
        statusCategory: "indeterminate",
        priority: "High",
        assignee: { id: "anh", displayName: "Anh Nguyen" },
        updated: new Date().toISOString(),
        url: "https://jira.example.com/browse/RTT-7",
      }],
      sprintScoped: true,
    })),
    statuses: vi.fn().mockResolvedValue(ok(STATUSES)),
    issue: vi.fn().mockResolvedValue(ok(DETAIL)),
    transitions: vi.fn().mockResolvedValue(ok(TRANSITIONS)),
    transition: vi.fn().mockResolvedValue(ok(undefined)),
    comment: vi.fn().mockResolvedValue(ok({
      id: "c2", author: "Anh Nguyen", body: "Still broken at 393px.", created: new Date().toISOString(),
    })),
    attachment: vi.fn().mockResolvedValue(ok("data:image/png;base64,AAA")),
  };
  (window as unknown as { tester: unknown }).tester = { jira, openExternal: vi.fn() };

  useStore.setState({ project: "RTT", openIssue: "", queue: { statuses: ["Ready for QA"], sprintOnly: true, open: true } });

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Queue list", () => {
  it("asks Jira for exactly the project, statuses and scope the tester chose", async () => {
    await act(async () => { root.render(<Queue />); });
    await settle();
    expect(jira.queue).toHaveBeenCalledWith({
      project: "RTT", statuses: ["Ready for QA"], sprintOnly: true,
    });
  });

  it("shows the issue with its key, status and assignee", async () => {
    await act(async () => { root.render(<Queue />); });
    await settle();
    expect(text()).toContain("RTT-7");
    expect(text()).toContain("Price renders as NaN on the cart");
    expect(text()).toContain("Anh Nguyen");
  });

  it("says the queue is empty rather than showing nothing at all", async () => {
    jira.queue.mockResolvedValue(ok({ issues: [], sprintScoped: true }));
    await act(async () => { root.render(<Queue />); });
    await settle();
    expect(text()).toContain("Nothing here");
    expect(text()).toContain("Ready for QA");
  });

  it("surfaces a Jira error instead of an empty list that looks like good news", async () => {
    jira.queue.mockResolvedValue({ ok: false, error: "401 Unauthorized" });
    await act(async () => { root.render(<Queue />); });
    await settle();
    expect(text()).toContain("401 Unauthorized");
  });

  it("admits when the sprint filter had to be dropped", async () => {
    // Otherwise a project-wide list sits under a header claiming "current sprint".
    jira.queue.mockResolvedValue(ok({ issues: [], sprintScoped: false }));
    await act(async () => { root.render(<Queue />); });
    await settle();
    expect(text()).toContain("no sprint");
  });
});

describe("Queue detail", () => {
  const open = async () => {
    await act(async () => { root.render(<Queue />); });
    await settle();
    await act(async () => { click("RTT-7"); });
    await settle();
  };

  it("shows summary, assignee, description, comments and attachments", async () => {
    await open();
    const out = text();
    expect(out).toContain("Price renders as NaN on the cart");
    expect(out).toContain("Anh Nguyen");
    expect(out).toContain("Bob Smith");
    expect(out).toContain("cart.png");
    // Description is rendered readably, not as wiki-markup source.
    expect(out).toContain("Steps");
    expect(out).not.toContain("h3.");
    expect(out).not.toContain("{{NaN}}");
    // Comment bodies get the same treatment.
    expect(out).toContain("Cannot reproduce on staging.");
  });

  it("offers the status the workflow permits, and moves the issue there", async () => {
    await open();
    expect(text()).toContain("Move");
    await act(async () => { click("Move"); });
    await act(async () => { click("Done"); });
    await settle();
    expect(jira.transition).toHaveBeenCalledWith("RTT-7", "31");
    // Re-read rather than assume: a post-function can land it elsewhere.
    expect(jira.issue).toHaveBeenCalledTimes(2);
  });

  it("posts a comment and shows it without a full refetch", async () => {
    await open();
    const box = host.querySelector("textarea");
    expect(box).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "Still broken at 393px.");
      box!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { click("Comment"); });
    await settle();
    expect(jira.comment).toHaveBeenCalledWith("RTT-7", "Still broken at 393px.");
    expect(text()).toContain("Still broken at 393px.");
  });

  it("does not fetch attachment bytes until the tester asks for them", async () => {
    await open();
    expect(jira.attachment).not.toHaveBeenCalled();
    await act(async () => { click("cart.png"); });
    await settle();
    expect(jira.attachment).toHaveBeenCalledWith(DETAIL.attachments[0].content);
    expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAA");
  });

  it("keeps the pane usable when transitions cannot be read", async () => {
    // A closed issue, or a locked-down workflow, returns nothing here. That
    // costs the Move button and must not cost the whole issue.
    jira.transitions.mockResolvedValue({ ok: false, error: "403 Forbidden" });
    await open();
    expect(text()).toContain("Price renders as NaN on the cart");
    expect(text()).not.toContain("Move");
  });
});
