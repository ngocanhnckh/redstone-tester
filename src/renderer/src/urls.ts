// URL and reproduction-path helpers. Pure, so they're unit-testable without a
// browser or a React tree.

import type { CaptureContext } from "../../shared/types.js";
import type { Lang } from "../../shared/i18n.js";
import { fill, ticketStrings } from "../../shared/i18n.js";

/** Turn whatever the tester typed into a loadable URL: bare domains get https,
 *  localhost gets http (dev servers rarely have TLS), anything that isn't
 *  domain-shaped becomes a search. */
export function normalizeAddress(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(raw)) return `http://${raw}`;
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/|\?|#|$)/i.test(raw)) return `https://${raw}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`;
}

/** Path portion of a URL, tolerant of the non-http URLs a guest can sit on
 *  (about:blank, data:, a failed load) — those must not throw mid-capture. */
export function pathOf(url: string): string {
  try { return new URL(url).pathname || "/"; } catch { return url; }
}

/** The reproduction path: everything the tester recorded, in order.
 *
 *  Recording is started deliberately, so the whole log is intentional — an
 *  earlier version trimmed to the last navigation onto the origin under test,
 *  which silently deleted legitimate cross-origin steps like an SSO login. If
 *  nothing was recorded, opening the page is the only honest step we can state. */
export function derivedSteps(ctx: CaptureContext, lang: Lang = "English"): string[] {
  const slice = ctx.steps.map((s) => s.text).filter((t) => t.trim());
  return slice.length ? slice : [fill(ticketStrings(lang).openStep, ctx.url)];
}
