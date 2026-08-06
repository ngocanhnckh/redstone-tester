import { describe, expect, it } from "vitest";
import { retestMarkdown, ticketMarkdown } from "./ticketFormat.js";
import { markdownToJira } from "./jiraMarkup.js";
import type { Annotation, CaptureContext, Ticket } from "./types.js";

const annotation: Annotation = {
  id: 1, kind: "element", note: "Price shows as NaN",
  selector: "#total", domPath: "main > div.summary > span#total", tag: "span",
  attrs: { id: "total", class: "summary__total" },
  text: "$NaN",
  styles: { color: "rgb(220, 38, 38)", "font-size": "18px", size: "84x22px" },
  box: { x: 10, y: 20, w: 84, h: 22 }, vw: 1280, vh: 800,
  url: "https://shop.test/cart",
};

const ctx: CaptureContext = {
  url: "https://shop.test/cart",
  title: "Cart",
  annotations: [annotation],
  steps: [],
  viewport: { w: 393, h: 852 },
  device: "iPhone 15 / 14 Pro — 393×852 @3x (portrait)",
  userAgent: "Mozilla/5.0 Chrome/130",
  consoleErrors: ["TypeError: cannot read property 'price' of undefined"],
};

const ticket: Ticket = {
  summary: "Cart total renders as NaN",
  description: "Shoppers cannot tell what they will be charged.",
  stepsToReproduce: ["Open https://shop.test/", "Add an item to the cart", "Open the cart"],
  expected: "The total shows the sum of line items.",
  current: "The total shows $NaN.",
  severity: "Critical",
  environment: "staging, build 412",
  labels: ["cart"],
};

describe("ticketMarkdown", () => {
  const md = ticketMarkdown(ticket, ctx, { attachmentNames: ["element-1.png"], tester: "Anh" });

  it("emits every section a developer needs", () => {
    for (const heading of [
      "## Steps to reproduce", "## Expected behaviour", "## Current behaviour",
      "## DOM reference", "## Console output", "## Environment", "## Screenshots",
    ]) expect(md).toContain(heading);
  });

  it("numbers the steps", () => {
    expect(md).toContain("1. Open https://shop.test/");
    expect(md).toContain("3. Open the cart");
  });

  it("carries the DOM identity of the highlighted element", () => {
    expect(md).toContain("`#total`");
    expect(md).toContain("main > div.summary > span#total");
    expect(md).toContain("Price shows as NaN");
    expect(md).toContain("color: rgb(220, 38, 38)");
  });

  it("records the environment automatically", () => {
    expect(md).toContain("- URL: https://shop.test/cart");
    expect(md).toContain("- Viewport: 393×852");
    // The device line is what makes a responsive bug reproducible at all.
    expect(md).toContain("- Device: iPhone 15 / 14 Pro — 393×852 @3x (portrait)");
    expect(md).toContain("- Severity: Critical");
    expect(md).toContain("staging, build 412");
  });

  it("still names the environment when no device was emulated", () => {
    const { device, ...noDevice } = ctx;
    expect(ticketMarkdown(ticket, noDevice)).toContain("- Device: Desktop window");
  });

  it("falls back to opening the page when no steps were captured", () => {
    const out = ticketMarkdown({ ...ticket, stepsToReproduce: [] }, ctx);
    expect(out).toContain("1. Open https://shop.test/cart");
  });

  it("marks unfilled sections rather than emitting an empty heading", () => {
    const out = ticketMarkdown({ ...ticket, expected: "" }, ctx);
    expect(out).toContain("## Expected behaviour\n_Not specified._");
  });

  it("survives the Jira wiki-markup conversion with its structure intact", () => {
    const wiki = markdownToJira(md);
    expect(wiki).toContain("h2. Steps to reproduce");
    expect(wiki).toContain("h2. DOM reference");
    expect(wiki).toContain("{{#total}}");
    expect(wiki).not.toContain("## ");
  });
});

describe("retestMarkdown", () => {
  const base = {
    url: "https://shop.test/cart",
    device: "iPhone 15 / 14 Pro — 393×852 @3x (portrait)",
    steps: ["Open https://shop.test/", "Open the cart"],
    notes: "",
  };

  it("leads with the verdict, because that is why the issue was opened", () => {
    const out = retestMarkdown({ ...base, verdict: "passed" });
    expect(out.split("\n")[0]).toBe("**Retest passed**");
  });

  it("records where it was retested — a pass at the wrong width is not a pass", () => {
    const out = retestMarkdown({ ...base, verdict: "passed" });
    expect(out).toContain("Retested on iPhone 15 / 14 Pro — 393×852 @3x (portrait) · https://shop.test/cart");
  });

  it("carries the steps that were actually followed", () => {
    const out = retestMarkdown({ ...base, verdict: "passed" });
    expect(out).toContain("## Steps followed");
    expect(out).toContain("1. Open https://shop.test/");
    expect(out).toContain("2. Open the cart");
  });

  it("attaches evidence and console output only when it still reproduces", () => {
    const evidence = {
      ...base,
      annotations: [annotation],
      attachmentNames: ["retest-element-1.png"],
      consoleErrors: ["TypeError: nope"],
    };
    const failed = retestMarkdown({ ...evidence, verdict: "failed" });
    expect(failed).toContain("## New evidence");
    expect(failed).toContain("`#total`");
    expect(failed).toContain("TypeError: nope");

    // Screenshots of a working page prove nothing and cost the reader a scroll.
    const passed = retestMarkdown({ ...evidence, verdict: "passed" });
    expect(passed).not.toContain("## New evidence");
    expect(passed).not.toContain("TypeError: nope");
    // The attachment list still stands: they were uploaded either way.
    expect(passed).toContain("retest-element-1.png");
  });

  it("writes the verdict in the ticket language", () => {
    const out = retestMarkdown({ ...base, verdict: "failed" }, { lang: "Tiếng Việt" });
    expect(out).toContain("Kiểm thử lại: vẫn tái hiện được");
    expect(out).toContain("Các bước đã thực hiện");
  });

  it("falls back to English for a language with no headings yet", () => {
    // Half a ticket in one language reads worse than all of it in English.
    const out = retestMarkdown({ ...base, verdict: "passed" }, { lang: "Deutsch" });
    expect(out).toContain("Retest passed");
  });

  it("survives a retest with no steps, no notes and no evidence", () => {
    const out = retestMarkdown({ verdict: "passed", url: "", device: "", steps: [], notes: "" });
    expect(out).toBe("**Retest passed**");
  });

  it("converts to wiki markup without leaking Markdown markers", () => {
    const wiki = markdownToJira(retestMarkdown({ ...base, verdict: "passed", notes: "Fixed in build 419." }));
    expect(wiki).toContain("*Retest passed*");
    expect(wiki).toContain("h2. Steps followed");
    expect(wiki).toContain("# Open https://shop.test/");
    expect(wiki).not.toContain("**");
  });
});
