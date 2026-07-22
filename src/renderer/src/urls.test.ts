import { describe, expect, it } from "vitest";
import { derivedSteps, normalizeAddress, pathOf } from "./urls.js";
import type { CaptureContext, Step } from "../../shared/types.js";

describe("normalizeAddress", () => {
  it("keeps an explicit scheme untouched", () => {
    expect(normalizeAddress("https://a.com/x?y=1")).toBe("https://a.com/x?y=1");
    expect(normalizeAddress("http://a.com")).toBe("http://a.com");
    expect(normalizeAddress("file:///tmp/a.html")).toBe("file:///tmp/a.html");
  });

  it("sends dev hosts over http, since they rarely have TLS", () => {
    expect(normalizeAddress("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeAddress("127.0.0.1:8080/admin")).toBe("http://127.0.0.1:8080/admin");
  });

  it("upgrades bare domains to https", () => {
    expect(normalizeAddress("staging.acme.io")).toBe("https://staging.acme.io");
    expect(normalizeAddress("acme.io/pricing")).toBe("https://acme.io/pricing");
  });

  it("treats non-domain input as a search", () => {
    expect(normalizeAddress("checkout is broken")).toBe("https://duckduckgo.com/?q=checkout%20is%20broken");
  });

  it("returns empty for blank input so we never load about:blank by accident", () => {
    expect(normalizeAddress("   ")).toBe("");
  });
});

describe("pathOf", () => {
  it("extracts the path", () => {
    expect(pathOf("https://a.com/checkout/step-2?x=1")).toBe("/checkout/step-2");
    expect(pathOf("https://a.com")).toBe("/");
  });

  it("does not throw on URLs the guest can legitimately sit on", () => {
    expect(pathOf("about:blank")).toBe("blank");
    expect(pathOf("not a url")).toBe("not a url");
  });
});

const step = (kind: Step["kind"], text: string, t = 0): Step =>
  ({ kind, text, t, url: "https://shop.test/cart" });

const ctx = (steps: Step[], url = "https://shop.test/cart"): CaptureContext => ({
  url, title: "", annotations: [], steps, viewport: { w: 1280, h: 800 },
  userAgent: "", consoleErrors: [],
});

describe("derivedSteps", () => {
  it("keeps the whole recording, including cross-origin steps", () => {
    // Recording is started deliberately, so a login on an SSO domain is part of
    // the repro path, not noise to be trimmed.
    const out = derivedSteps(ctx([
      step("navigate", "Open https://shop.test/", 1),
      step("click", 'Click the link "Sign in"', 2),
      step("navigate", "Open https://sso.example.com/login", 3),
      step("input", 'Enter "qa@acme.io" into the "Email" field', 4),
      step("navigate", "Open https://shop.test/cart", 5),
      step("click", 'Click the button "Checkout"', 6),
    ]));
    expect(out).toEqual([
      "Open https://shop.test/",
      'Click the link "Sign in"',
      "Open https://sso.example.com/login",
      'Enter "qa@acme.io" into the "Email" field',
      "Open https://shop.test/cart",
      'Click the button "Checkout"',
    ]);
  });

  it("falls back to opening the page when nothing was recorded", () => {
    expect(derivedSteps(ctx([]))).toEqual(["Open https://shop.test/cart"]);
  });

  it("drops blank steps rather than emitting an empty line", () => {
    expect(derivedSteps(ctx([step("click", "   ", 1)]))).toEqual(["Open https://shop.test/cart"]);
  });

  it("survives a capture on a non-http URL", () => {
    const out = derivedSteps(ctx([step("click", 'Click the button "Go"', 1)], "about:blank"));
    expect(out).toEqual(['Click the button "Go"']);
  });
});
