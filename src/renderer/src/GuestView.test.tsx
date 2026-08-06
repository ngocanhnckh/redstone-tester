// @vitest-environment jsdom
//
// The guest is configured entirely through attributes on a tag React knows
// nothing about, which makes it exactly the place where a wrong-typed prop
// disappears without a word. `allowpopups` did: passed as a boolean, React
// dropped it, and every window.open in the page under test was blocked — which
// presents as "signing in with Google does nothing", not as a missing
// attribute. These assert what actually reached the DOM.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GuestView from "./GuestView.js";
import type { Tab } from "../../shared/tabs.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TAB: Tab = {
  id: "t1", url: "https://shop.test/cart", title: "Cart",
  loading: false, back: false, fwd: false, ready: false,
};

let host: HTMLDivElement;
let root: Root;

const noop = (): void => {};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(): Promise<Element> {
  await act(async () => {
    root.render(
      <GuestView
        tab={TAB} active mode="off" recording={false} lang="English" frameScale={1}
        register={noop}
        onNavigate={noop} onState={noop} onConsole={noop} onReadyChange={noop} onInjectError={noop}
      />,
    );
  });
  const el = host.querySelector("webview");
  if (!el) throw new Error("no <webview> rendered");
  return el;
}

describe("the guest's attributes", () => {
  it("allows popups, so OAuth logins on the site under test can open", async () => {
    const el = await render();
    expect(el.hasAttribute("allowpopups")).toBe(true);
  });

  it("renders it without React warning the value never made it to the DOM", async () => {
    // React logs "Received `true` for a non-boolean attribute" and then omits
    // the attribute entirely. The omission is the bug; the warning is the tell.
    const spy = vi.spyOn(console, "error").mockImplementation(noop);
    await render();
    const complaints = spy.mock.calls.map((c) => String(c[0])).filter((m) => /non-boolean/.test(m));
    spy.mockRestore();
    expect(complaints).toEqual([]);
  });

  it("keeps every guest in the one persistent session, so a login survives a reload", async () => {
    const el = await render();
    expect(el.getAttribute("partition")).toBe("persist:rtt");
  });

  it("sets src once, from the tab's URL at mount", async () => {
    const el = await render();
    expect(el.getAttribute("src")).toBe(TAB.url);
  });
});
