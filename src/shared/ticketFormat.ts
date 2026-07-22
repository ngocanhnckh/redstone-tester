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
