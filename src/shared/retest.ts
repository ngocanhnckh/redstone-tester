// Reading a filed ticket back into something you can re-drive.
//
// The queue can already show an issue. Retesting it means recovering the three
// things the ticket already carries — where it happened, what to do, what should
// have happened — and putting them in front of the browser, so "dev says it's
// fixed" stops being a tab-switching exercise.
//
// This parses the WIKI MARKUP Jira stores, not the Markdown we compose. That is
// what the API hands back, and it carries structure (`h2.`, `#`, `*`) that the
// plain-text rendering in the sidebar has already thrown away.
//
// Deliberately tolerant, in this order of preference:
//   1. headings we recognise, in any language we ship or the model has supplied
//   2. failing that, POSITION — our own tickets always run steps → expected →
//      current, so the sections after the numbered list are those two
//   3. failing that, the untranslated parts: a URL is a URL and `393×852` is a
//      viewport in every language, so those are found by shape, not by label
// Tickets get hand-edited, filed by other tools, and written in whatever language
// the team files in. Nothing here may depend on a string match to work at all.

import type { TicketStrings } from "./i18n.js";
import { knownHeadings } from "./i18n.js";
import type { JiraTransition } from "./types.js";

export type Verdict = "passed" | "failed";

export interface RetestPlan {
  /** The page under test. Empty when the ticket names no URL. */
  url: string;
  /** Steps to reproduce, markers stripped. */
  steps: string[];
  expected: string;
  current: string;
  /** Device line as the ticket recorded it, e.g. `iPhone 15 — 393×852 @3x (portrait)`. */
  device: string;
  viewport: { w: number; h: number } | null;
}

const EMPTY: RetestPlan = { url: "", steps: [], expected: "", current: "", device: "", viewport: null };

/** Enough recovered to actually drive something. A ticket with neither a URL nor
 *  steps cannot be retested from here, and saying so beats an empty checklist. */
export function isActionable(plan: RetestPlan): boolean {
  return Boolean(plan.url) || plan.steps.length > 0;
}

interface Section { heading: string; lines: string[] }

/** Split the body on `h1.`–`h6.`. Anything before the first heading (the impact
 *  paragraph) becomes a leading section with an empty heading. */
function sections(wiki: string): Section[] {
  // Code blocks hold console output and stack traces, which are full of lines
  // that look like headings and list items. Drop them before splitting — nothing
  // a retest needs is ever inside one.
  const body = wiki
    .replace(/\{code(?::[^}]*)?\}[\s\S]*?\{code\}/g, "")
    .replace(/\{noformat\}[\s\S]*?\{noformat\}/g, "");

  const out: Section[] = [{ heading: "", lines: [] }];
  for (const line of body.split("\n")) {
    const m = /^h[1-6]\.\s*(.*)$/.exec(line);
    if (m) out.push({ heading: m[1].trim(), lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

/** Numbered-list items in a section. Accepts Jira's `#` and Markdown's `1.`,
 *  since a description can be stored either way depending on who wrote it. */
function numbered(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = /^(?:#+|\d+[.)])\s+(.+)$/.exec(line);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** `label: value` bullets. `*[1] {{sel}}*` is bold, not a bullet — requiring
 *  whitespace after the markers is what tells the two apart. */
function fields(lines: string[]): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const raw of lines) {
    const m = /^\*+\s+(.+)$/.exec(raw.trim());
    if (!m) continue;
    const colon = m[1].indexOf(":");
    if (colon <= 0) continue;
    out.push({ label: m[1].slice(0, colon).trim(), value: m[1].slice(colon + 1).trim() });
  }
  return out;
}

/** Compare labels by meaning, not by decoration: emphasis markers and trailing
 *  punctuation differ between a heading and the same words written as prose. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/^_+|_+$/g, "").replace(/[:：.]+$/, "").trim();
}

/** Labels for one heading key: the languages we ship, plus whatever the model
 *  supplied for a language we don't. */
function labelsFor(key: keyof TicketStrings, extra: Array<Partial<TicketStrings>>): Set<string> {
  const set = new Set(knownHeadings(key).map(normalize));
  for (const e of extra) {
    const v = e[key];
    if (typeof v === "string" && v.trim()) set.add(normalize(v));
  }
  return set;
}

/** Section text as prose: markers off, placeholder treated as absent. */
function prose(section: Section | undefined, notSpecified: Set<string>): string {
  if (!section) return "";
  const text = section.lines
    .map((l) => l.replace(/^\s*(?:[*#]+|\d+[.)])\s+/, "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // `_Not specified._` is what we write for a field the tester left empty. It is
  // a placeholder, not an expectation, and showing it as one would be a lie.
  return notSpecified.has(normalize(text)) ? "" : text;
}

const URL_RE = /^https?:\/\/\S+$/;
const SIZE_RE = /\b\d+\s*[×x]\s*\d+\b/;

/**
 * Recover a retest plan from an issue description.
 *
 * @param extraHeadings model-supplied heading sets from settings, for ticket
 *   languages without a built-in translation.
 */
export function parseRetestPlan(
  wiki: string, extraHeadings: Array<Partial<TicketStrings>> = [],
): RetestPlan {
  if (!wiki || !wiki.trim()) return { ...EMPTY };

  const secs = sections(wiki);
  const notSpecified = labelsFor("notSpecified", extraHeadings);
  // Every heading key we know, so the positional fallback can tell "an untitled
  // section that is probably `expected`" from "the Environment block".
  const recognised = new Set<string>();
  for (const key of ["steps", "expected", "current", "domReference", "consoleOutput",
    "environment", "screenshots"] as Array<keyof TicketStrings>) {
    for (const label of labelsFor(key, extraHeadings)) recognised.add(label);
  }

  // ── steps ────────────────────────────────────────────────────────────────
  // The first section holding a numbered list. In our own tickets that is the
  // steps section; in a hand-written one it is whatever the author numbered,
  // which is the same thing under a different name.
  let stepsAt = -1;
  let steps: string[] = [];
  for (let i = 0; i < secs.length; i++) {
    const items = numbered(secs[i].lines);
    if (items.length) { stepsAt = i; steps = items; break; }
  }

  // ── expected / current ───────────────────────────────────────────────────
  const expectedLabels = labelsFor("expected", extraHeadings);
  const currentLabels = labelsFor("current", extraHeadings);
  let expected = prose(secs.find((s) => expectedLabels.has(normalize(s.heading))), notSpecified);
  let current = prose(secs.find((s) => currentLabels.has(normalize(s.heading))), notSpecified);

  // Positional fallback, used only for sections whose heading we do not
  // recognise as something else — otherwise a ticket filed in an unknown
  // language would read its Environment block as "expected behaviour".
  const unclaimed = (i: number): Section | undefined => {
    const s = secs[i];
    return s && !recognised.has(normalize(s.heading)) ? s : undefined;
  };
  if (!expected && stepsAt >= 0) expected = prose(unclaimed(stepsAt + 1), notSpecified);
  if (!current && stepsAt >= 0) current = prose(unclaimed(stepsAt + 2), notSpecified);

  // ── environment ──────────────────────────────────────────────────────────
  // By shape, not by label: URLs and `393×852` survive translation, headings
  // do not.
  const all = secs.flatMap((s) => fields(s.lines));
  let url = all.find((f) => URL_RE.test(f.value))?.value ?? "";
  // A ticket with no environment block still names the page in its first step.
  if (!url) url = steps.map((s) => /https?:\/\/\S+/.exec(s)?.[0] ?? "").find(Boolean) ?? "";
  if (!url) url = /https?:\/\/\S+/.exec(wiki)?.[0] ?? "";
  url = url.replace(/[.,;)\]]+$/, "");

  // The device line pairs a name with a size (`iPhone 15 — 393×852 @3x`); the
  // viewport line is a bare size. That shape difference is what distinguishes
  // them without knowing either label.
  const device = all.find((f) => SIZE_RE.test(f.value) && /[—–-]/.test(f.value))?.value ?? "";
  const size = all.map((f) => /^(\d+)\s*[×x]\s*(\d+)$/.exec(f.value)).find(Boolean);

  return {
    url,
    steps,
    expected,
    current,
    device,
    viewport: size ? { w: Number(size[1]), h: Number(size[2]) } : null,
  };
}

/**
 * The workflow move a verdict most likely wants, so the common case is one click.
 *
 * Chosen by the status CATEGORY the transition lands in, never by its name.
 * `done` is Jira's own grouping and it holds however a project spells the idea —
 * "Closed", "Verified in staging", "Shipped". Matching on names would work on
 * one project's workflow and quietly pick the wrong status on the next.
 *
 * The one hard rule is in the failure branch: never suggest a `done` move for a
 * bug that still reproduces. Suggesting it puts closing a live defect one
 * unexamined click away, and the whole point of the retest is that someone
 * checked.
 */
export function suggestTransition(verdict: Verdict, transitions: JiraTransition[]): string {
  if (verdict === "passed") {
    return transitions.find((t) => t.toCategory === "done")?.id ?? "";
  }
  const back = transitions.filter((t) => t.toCategory && t.toCategory !== "done");
  const reopen = back.find((t) => /reopen|re-open/i.test(t.name));
  // Prefer a move that reads as putting it back into play over one that merely
  // parks it somewhere else.
  const inProgress = back.find((t) => t.toCategory === "indeterminate");
  return (reopen ?? inProgress ?? back[0])?.id ?? "";
}
