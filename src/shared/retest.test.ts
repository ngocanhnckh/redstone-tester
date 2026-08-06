import { describe, expect, it } from "vitest";
import { isActionable, parseRetestPlan, suggestTransition } from "./retest.js";
import type { JiraTransition } from "./types.js";
import { markdownToJira } from "./jiraMarkup.js";
import { ticketMarkdown } from "./ticketFormat.js";
import type { CaptureContext, Ticket } from "./types.js";

// The strongest available check: build a body with the SAME renderer that files
// real tickets, convert it the same way the Jira client does, then read it back.
// A change to either end that breaks the round trip fails here rather than in a
// tester's hands.
function filed(over: Partial<Ticket> = {}, ctxOver: Partial<CaptureContext> = {}, lang = "English"): string {
  const ticket: Ticket = {
    summary: "Discount code is not applied at checkout",
    description: "Shoppers with a valid code are charged full price.",
    stepsToReproduce: [
      "Open https://shop.example.com/checkout",
      'Enter "SAVE10" into the "Discount code" field',
      'Click the "Apply" button',
    ],
    expected: "The order total drops by 10%.",
    current: "The total is unchanged and no error is shown.",
    severity: "Major",
    environment: "",
    labels: [],
    ...over,
  };
  const ctx: CaptureContext = {
    url: "https://shop.example.com/checkout",
    title: "Checkout",
    annotations: [],
    steps: [],
    viewport: { w: 393, h: 852 },
    device: "iPhone 15 / 14 Pro — 393×852 @3x (portrait)",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    consoleErrors: [],
    ...ctxOver,
  };
  return markdownToJira(ticketMarkdown(ticket, ctx, { lang }));
}

describe("round trip through a real filed ticket", () => {
  it("recovers the URL, steps, expected and current", () => {
    const plan = parseRetestPlan(filed());
    expect(plan.url).toBe("https://shop.example.com/checkout");
    expect(plan.steps).toEqual([
      "Open https://shop.example.com/checkout",
      'Enter "SAVE10" into the "Discount code" field',
      'Click the "Apply" button',
    ]);
    expect(plan.expected).toBe("The order total drops by 10%.");
    expect(plan.current).toBe("The total is unchanged and no error is shown.");
    expect(isActionable(plan)).toBe(true);
  });

  it("recovers the device line and viewport", () => {
    const plan = parseRetestPlan(filed());
    expect(plan.device).toBe("iPhone 15 / 14 Pro — 393×852 @3x (portrait)");
    expect(plan.viewport).toEqual({ w: 393, h: 852 });
  });

  it("reads a ticket filed in Vietnamese", () => {
    const plan = parseRetestPlan(filed({}, {}, "Tiếng Việt"));
    expect(plan.url).toBe("https://shop.example.com/checkout");
    expect(plan.steps).toHaveLength(3);
    expect(plan.expected).toBe("The order total drops by 10%.");
    expect(plan.current).toBe("The total is unchanged and no error is shown.");
  });

  it("treats the not-specified placeholder as absent, not as an expectation", () => {
    const plan = parseRetestPlan(filed({ expected: "" }));
    expect(plan.expected).toBe("");
    // The section is still there, so the fallback must not slide `current` up
    // into its place.
    expect(plan.current).toBe("The total is unchanged and no error is shown.");
  });

  it("is not fooled by a DOM reference block, whose bold lines look like bullets", () => {
    const plan = parseRetestPlan(filed({}, {
      annotations: [{
        id: 1,
        kind: "element",
        note: "no feedback",
        selector: "button.apply",
        domPath: "main > form > button.apply",
        text: "Apply",
        attrs: { href: "https://tracker.example.com/click" },
        box: { x: 10, y: 20, w: 80, h: 30 },
        vw: 393,
        vh: 852,
        url: "https://shop.example.com/checkout",
      }],
    }));
    // The attribute URL must not win over the Environment block's.
    expect(plan.url).toBe("https://shop.example.com/checkout");
    expect(plan.expected).toBe("The order total drops by 10%.");
  });

  it("ignores console output, which is full of heading- and list-shaped lines", () => {
    const plan = parseRetestPlan(filed({}, {
      consoleErrors: [
        "# not a step",
        "h2. Expected behaviour",
        "* URL: https://evil.example.com/nope",
      ],
    }));
    expect(plan.url).toBe("https://shop.example.com/checkout");
    expect(plan.steps).toHaveLength(3);
    expect(plan.expected).toBe("The order total drops by 10%.");
  });
});

describe("tickets we did not write", () => {
  it("reads a hand-written wiki-markup ticket by position", () => {
    const plan = parseRetestPlan([
      "The login page rejects valid credentials.",
      "",
      "h3. How to see it",
      "# Go to https://app.example.com/login",
      "# Sign in as qa@example.com",
      "",
      "h3. Should happen",
      "You land on the dashboard.",
      "",
      "h3. Happens instead",
      'You get "Invalid credentials".',
    ].join("\n"));
    expect(plan.url).toBe("https://app.example.com/login");
    expect(plan.steps).toEqual(["Go to https://app.example.com/login", "Sign in as qa@example.com"]);
    expect(plan.expected).toBe("You land on the dashboard.");
    expect(plan.current).toBe('You get "Invalid credentials".');
  });

  it("reads a markdown-numbered ticket", () => {
    const plan = parseRetestPlan([
      "h2. Steps",
      "1. Open https://app.example.com/settings",
      "2. Toggle dark mode",
    ].join("\n"));
    expect(plan.steps).toEqual(["Open https://app.example.com/settings", "Toggle dark mode"]);
    expect(plan.url).toBe("https://app.example.com/settings");
  });

  it("falls back to any URL in the body when there is no list and no bullet", () => {
    const plan = parseRetestPlan("The banner overlaps the nav on https://example.com/pricing, see attached.");
    expect(plan.url).toBe("https://example.com/pricing");
    expect(plan.steps).toEqual([]);
    // A URL alone is still something to open.
    expect(isActionable(plan)).toBe(true);
  });

  it("reports nothing to retest rather than an empty checklist", () => {
    const plan = parseRetestPlan("Looks wrong on mobile.");
    expect(plan.url).toBe("");
    expect(plan.steps).toEqual([]);
    expect(isActionable(plan)).toBe(false);
  });

  it("survives an empty description", () => {
    expect(isActionable(parseRetestPlan(""))).toBe(false);
    expect(parseRetestPlan("   ").viewport).toBeNull();
  });
});

describe("heading recognition", () => {
  it("uses model-supplied headings for a language we do not ship", () => {
    const wiki = [
      "h2. Reproduktionsschritte",
      "# Öffne https://shop.example.de/kasse",
      "",
      "h2. Erwartetes Verhalten",
      "Der Rabatt wird abgezogen.",
      "",
      "h2. Aktuelles Verhalten",
      "Nichts passiert.",
      "",
      "h2. Umgebung",
      "* URL: https://shop.example.de/kasse",
    ].join("\n");
    const plan = parseRetestPlan(wiki, [{
      steps: "Reproduktionsschritte",
      expected: "Erwartetes Verhalten",
      current: "Aktuelles Verhalten",
      environment: "Umgebung",
    }]);
    expect(plan.expected).toBe("Der Rabatt wird abgezogen.");
    expect(plan.current).toBe("Nichts passiert.");
  });

  it("does not read a recognised section as expected behaviour by position", () => {
    // Steps, then straight to Environment — nothing to fall back onto, and
    // guessing the environment block would be worse than saying nothing.
    const plan = parseRetestPlan([
      "h2. Steps to reproduce",
      "# Open https://example.com/a",
      "",
      "h2. Environment",
      "* URL: https://example.com/a",
      "* Viewport: 1280×800",
    ].join("\n"));
    expect(plan.expected).toBe("");
    expect(plan.current).toBe("");
    expect(plan.viewport).toEqual({ w: 1280, h: 800 });
  });
});

describe("suggestTransition", () => {
  const t = (id: string, name: string, to: string, toCategory?: string): JiraTransition =>
    ({ id, name, to, toCategory });

  const workflow = [
    t("11", "Reopen", "Reopened", "new"),
    t("21", "Start work", "In Progress", "indeterminate"),
    t("31", "Close", "Closed", "done"),
  ];

  it("suggests closing the issue when the retest passes", () => {
    expect(suggestTransition("passed", workflow)).toBe("31");
  });

  it("suggests reopening when it still reproduces", () => {
    expect(suggestTransition("failed", workflow)).toBe("11");
  });

  it("never suggests a done transition for a bug that still reproduces", () => {
    // The failure that matters: one unexamined click closing a live defect.
    for (const w of [workflow, [t("31", "Close", "Closed", "done")], []]) {
      const id = suggestTransition("failed", w);
      expect(w.find((x) => x.id === id)?.toCategory).not.toBe("done");
    }
  });

  it("goes by status category, not by a name it happens to recognise", () => {
    // A project that calls it "Verified in staging" must still be found.
    const odd = [t("9", "Ship it", "Verified in staging", "done")];
    expect(suggestTransition("passed", odd)).toBe("9");
  });

  it("falls back to putting it back in progress when nothing says reopen", () => {
    expect(suggestTransition("failed", [
      t("41", "Triage", "Needs triage", "new"),
      t("42", "Pick up", "In Progress", "indeterminate"),
    ])).toBe("42");
  });

  it("suggests nothing rather than a wrong move when the workflow offers none", () => {
    expect(suggestTransition("passed", [])).toBe("");
    expect(suggestTransition("failed", [])).toBe("");
    // A transition Jira gave no category for is not safe to guess at.
    expect(suggestTransition("passed", [t("1", "Next", "Somewhere")])).toBe("");
    expect(suggestTransition("failed", [t("1", "Next", "Somewhere")])).toBe("");
  });
});
