// The single renderer for a ticket body. Whatever the tester previews is exactly
// what gets filed or copied — the Jira path only converts this Markdown to wiki
// markup, it never re-composes the content.

import { Annotation, CaptureContext, Ticket } from "./types.js";
import { Lang, TicketStrings, fill, ticketStrings } from "./i18n.js";

/** A compact, developer-usable reference to one highlighted element. */
function domBlock(a: Annotation, t: TicketStrings): string {
  const lines: string[] = [];
  const head = a.kind === "region"
    ? `**[${a.id}] ${t.region}** — ${Math.round(a.box.w)}×${Math.round(a.box.h)} at (${Math.round(a.box.x)}, ${Math.round(a.box.y)})`
    : `**[${a.id}] \`${a.selector ?? a.tag ?? "element"}\`**`;
  lines.push(head);
  if (a.note) lines.push(`- ${t.observed}: ${a.note}`);
  if (a.domPath) lines.push(`- ${t.domPath}: \`${a.domPath}\``);
  if (a.text) lines.push(`- ${t.text}: "${a.text.slice(0, 200)}"`);
  if (a.attrs && Object.keys(a.attrs).length) {
    lines.push(`- ${t.attributes}: ${Object.entries(a.attrs).map(([k, v]) => `\`${k}="${v}"\``).join(", ")}`);
  }
  if (a.styles && Object.keys(a.styles).length) {
    // Only the styles a reader can act on; the full computed set is noise.
    const interesting = ["color", "background-color", "font-size", "display", "visibility", "opacity", "size"];
    const picked = interesting
      .filter((k) => a.styles?.[k])
      .map((k) => `${k}: ${a.styles?.[k]}`);
    if (picked.length) lines.push(`- ${t.computed}: ${picked.join("; ")}`);
  }
  return lines.join("\n");
}

export interface RenderOpts {
  /** Attachment filenames, so the body can point at the images Jira will hold. */
  attachmentNames?: string[];
  /** Reporter name for the footer. */
  tester?: string;
  /** Language for the headings the tool writes. Defaults to English. */
  lang?: Lang;
  /** Model-supplied headings for a language without a built-in translation. */
  headings?: Partial<TicketStrings>;
}

export function ticketMarkdown(ticket: Ticket, ctx: CaptureContext, opts: RenderOpts = {}): string {
  const t = ticket;
  const L = ticketStrings(opts.lang ?? "English", opts.headings);
  const out: string[] = [];

  if (t.description.trim()) out.push(t.description.trim(), "");

  out.push(`## ${L.steps}`);
  const steps = t.stepsToReproduce.filter((s) => s.trim());
  out.push(steps.length
    ? steps.map((s, i) => `${i + 1}. ${s.trim()}`).join("\n")
    : `1. ${fill(L.openStep, ctx.url)}`);
  out.push("");

  out.push(`## ${L.expected}`, t.expected.trim() || L.notSpecified, "");
  out.push(`## ${L.current}`, t.current.trim() || L.notSpecified, "");

  if (ctx.annotations.length) {
    out.push(`## ${L.domReference}`);
    out.push(ctx.annotations.map((a) => domBlock(a, L)).join("\n\n"));
    out.push("");
  }

  if (ctx.consoleErrors.length) {
    out.push(`## ${L.consoleOutput}`);
    out.push("```");
    out.push(ctx.consoleErrors.slice(-10).join("\n"));
    out.push("```", "");
  }

  out.push(`## ${L.environment}`);
  const env = [
    `- ${L.url}: ${ctx.url}`,
    `- ${L.pageTitle}: ${ctx.title || L.untitled}`,
    // The device line is what makes a responsive bug reproducible — without it
    // "the header overlaps" is untestable.
    `- ${L.device}: ${ctx.device || L.desktopWindow}`,
    `- ${L.viewport}: ${ctx.viewport.w}×${ctx.viewport.h}`,
    `- ${L.userAgent}: ${ctx.userAgent}`,
    // The severity VALUE stays in English: it is a Jira field, not prose.
    `- ${L.severity}: ${t.severity}`,
  ];
  if (t.environment.trim()) env.push(`- ${L.notes}: ${t.environment.trim()}`);
  out.push(env.join("\n"), "");

  if (opts.attachmentNames?.length) {
    out.push(`## ${L.screenshots}`);
    out.push(opts.attachmentNames.map((n) => `- ${n}`).join("\n"), "");
  }

  out.push("---");
  out.push(opts.tester ? fill(L.filedBy, opts.tester) : L.filed);

  return out.join("\n");
}

/** Default attachment filename for an annotation's crop. */
export function shotName(a: Annotation): string {
  return a.kind === "region" ? `region-${a.id}.png` : `element-${a.id}.png`;
}

/** Crops from a retest, kept apart from the original filing's attachments so a
 *  reader can tell "how it looked when reported" from "how it looks now". */
export function retestShotName(a: Annotation): string {
  return `retest-${shotName(a)}`;
}

// ---------------------------------------------------------------------------
// Retest verdict
// ---------------------------------------------------------------------------

export interface RetestReport {
  verdict: "passed" | "failed";
  /** Where it was retested — not necessarily where it was filed, if the ticket
   *  named no URL and the tester drove somewhere themselves. */
  url: string;
  /** Device line the retest ran at. A pass at the wrong width is not a pass. */
  device: string;
  /** The steps the tester actually walked. */
  steps: string[];
  /** Whatever the tester wants to say about it. */
  notes: string;
  /** Fresh evidence, when it still reproduces. */
  annotations?: Annotation[];
  attachmentNames?: string[];
  consoleErrors?: string[];
}

/**
 * A retest verdict as a comment body.
 *
 * Same renderer as the ticket, for the same reason: what the tester previews is
 * what lands on the issue. Deliberately lighter than a ticket — the issue
 * already carries the report, and a comment that restates it buries the one
 * thing a developer opened it to read, which is whether it is fixed.
 */
export function retestMarkdown(r: RetestReport, opts: RenderOpts = {}): string {
  const L = ticketStrings(opts.lang ?? "English", opts.headings);
  const out: string[] = [];

  out.push(`**${r.verdict === "passed" ? L.retestPassed : L.retestFailed}**`, "");

  const where = [r.device, r.url].filter(Boolean).join(" · ");
  if (where) out.push(fill(L.retestedOn, where), "");

  if (r.notes.trim()) out.push(r.notes.trim(), "");

  const steps = r.steps.filter((s) => s.trim());
  if (steps.length) {
    out.push(`## ${L.stepsFollowed}`);
    out.push(steps.map((s, i) => `${i + 1}. ${s.trim()}`).join("\n"), "");
  }

  // Evidence only when it failed: screenshots of a working page prove nothing
  // and cost the reader a scroll.
  if (r.verdict === "failed" && r.annotations?.length) {
    out.push(`## ${L.newEvidence}`);
    out.push(r.annotations.map((a) => domBlock(a, L)).join("\n\n"), "");
  }

  if (r.verdict === "failed" && r.consoleErrors?.length) {
    out.push(`## ${L.consoleOutput}`);
    out.push("```", r.consoleErrors.slice(-10).join("\n"), "```", "");
  }

  if (r.attachmentNames?.length) {
    out.push(`## ${L.screenshots}`);
    out.push(r.attachmentNames.map((n) => `- ${n}`).join("\n"), "");
  }

  return out.join("\n").trimEnd();
}
