// OpenAI-compatible chat client. The model does not just rewrite the ticket — it
// reviews it: it reads the whole draft plus the evidence, rewrites what it can
// justify, tells the tester which parts are still too vague to act on, and asks
// questions back when the answer is something only the tester can know.
//
// Any endpoint speaking /chat/completions works (OpenAI, a gateway, OpenRouter,
// vLLM, Ollama's compat layer), which is why the base URL is a setting.

import { AppSettings, CaptureContext, Result, Ticket } from "../shared/types.js";
import {
  TRANSLATABLE, TicketStrings, hasBuiltInStrings, langName, pickStrings,
} from "../shared/i18n.js";

function system(questionLang: string, ticketLang: string, needHeadings: boolean): string {
  return `You are a senior QA lead reviewing a bug report before it reaches the engineering team. Developers must be able to act on it without asking a single follow-up question.

You receive: the tester's current draft, the page URL and title, the DOM elements they highlighted (CSS selectors, DOM paths, computed styles), the device and viewport under test, an automatically recorded action log, console errors, and screenshots of the defect.

Do three things.

1. REWRITE the ticket, using only what the evidence supports.
- summary: one specific sentence naming the component and the failure. Never "Bug on page" or "UI issue". Under 120 characters, no ticket-key prefix, no trailing period.
- description: 1-3 sentences of impact — who is affected and what they cannot do. No headings; the tool adds them.
- stepsToReproduce: numbered, imperative, one action each, starting from opening the URL. Use the recorded action log where it exists; drop noise. Note that the log records only what the tester did to the PRODUCT — highlighting a defect is never a step.
- expected: the correct product behaviour, concretely. Never "it should not be broken".
- current: only what was observed, with the evidence — selector, text, colour, console error, what the screenshot shows.
- If the defect only appears at the reported viewport, say so in current and add a "responsive" label.
- Reference highlighted elements by CSS selector in backticks where it clarifies things.
- severity: Blocker (unusable/data loss), Critical (core flow broken, no workaround), Major (feature broken, workaround exists), Minor (cosmetic with impact), Trivial (polish).
- Never invent behaviour you were not shown. Leave a field as the tester wrote it rather than guessing.

2. CRITIQUE what is still weak. For each problem, name the field, what is wrong with it, and a concrete rewrite. Judge against one bar: could a developer who has never seen this page reproduce and fix it? Common failures: expected behaviour that only negates the bug, steps that skip required state (logged in? which account? what data?), "doesn't work" with no observed symptom, no indication whether it is intermittent. Say nothing about fields that are already good — an empty critique is a valid answer.

3. ASK what you genuinely cannot infer. At most 4 questions, each about something that changes how a developer would fix it, and that only the tester can answer. Give 2-4 short suggested answers where the likely options are enumerable. Do not ask for anything already present in the evidence, and do not ask filler questions to reach four. Zero questions is the correct answer for a complete report.

Also return readiness: 0-100, your confidence that a developer could act on this ticket as it now stands.

If the tester has answered your earlier questions, treat those answers as authoritative evidence, fold them into the rewrite, and do not ask them again.

LANGUAGE. These two are independent — do not let one leak into the other.
- Write the TICKET (summary, description, stepsToReproduce, expected, current) in ${ticketLang}.
- Write your QUESTIONS and CRITIQUE (question, why, suggestions, issue, suggestion) in ${questionLang}.
- Keep verbatim and DO NOT translate: CSS selectors, DOM paths, code, URLs, console output, attribute names, and any text quoted from the page under test — a developer has to match those against the real product.
- \`severity\` must stay one of the exact English values listed above; it is a Jira field, not prose.
- \`labels\` must stay lowercase ASCII with hyphens, whatever the ticket language.${needHeadings ? `
- Also return \`headings\`: the ticket's section labels translated into ${ticketLang}, as {${TRANSLATABLE.map((k) => `"${k}"`).join(",")}}. Short noun phrases as a bug tracker would label them. Omit this key only if ${ticketLang} is English.` : ""}

Respond with ONLY a JSON object, no prose or code fences:
{"summary":string,"description":string,"stepsToReproduce":string[],"expected":string,"current":string,"severity":"Blocker"|"Critical"|"Major"|"Minor"|"Trivial","labels":string[],"critique":[{"field":string,"issue":string,"suggestion":string}],"questions":[{"id":string,"question":string,"why":string,"suggestions":string[]}],"readiness":number${needHeadings ? ',"headings":object' : ""}}`;
}

export interface Question {
  id: string;
  question: string;
  /** Why it matters — shown under the question so answering feels worthwhile. */
  why: string;
  suggestions: string[];
}

export interface Critique {
  /** Which ticket field the note is about, e.g. "expected". */
  field: string;
  issue: string;
  suggestion: string;
}

export type Draft = Pick<
  Ticket, "summary" | "description" | "stepsToReproduce" | "expected" | "current" | "severity" | "labels"
>;

export interface Review {
  draft: Draft;
  critique: Critique[];
  questions: Question[];
  /** 0-100 — how actionable the model thinks the ticket is as it stands. */
  readiness: number;
  /** Section headings in the ticket language, for languages without a built-in
   *  translation. Cached by the renderer so later tickets are not half-English. */
  headings?: Partial<TicketStrings>;
}

export interface ReviewInput {
  /** The draft as the tester currently has it. */
  ticket: Ticket;
  /** Free-text context typed into the composer. */
  hint: string;
  /** Answers to questions from a previous round. */
  answers: Array<{ question: string; answer: string }>;
}

/** Compact the capture into the prompt. Screenshots ride in image parts; the
 *  rest is a terse digest — verbose DOM dumps cost tokens and measurably
 *  degrade the write-up. */
function digest(ctx: CaptureContext, input: ReviewInput): string {
  const t = input.ticket;
  const lines: string[] = [];

  lines.push("=== CURRENT DRAFT ===");
  lines.push(`summary: ${t.summary || "(empty)"}`);
  lines.push(`description: ${t.description || "(empty)"}`);
  lines.push(`stepsToReproduce:${t.stepsToReproduce.length
    ? "\n" + t.stepsToReproduce.map((s, i) => `  ${i + 1}. ${s}`).join("\n") : " (empty)"}`);
  lines.push(`expected: ${t.expected || "(empty)"}`);
  lines.push(`current: ${t.current || "(empty)"}`);
  lines.push(`severity: ${t.severity}`);
  if (t.environment) lines.push(`environment notes: ${t.environment}`);

  lines.push("\n=== EVIDENCE ===");
  lines.push(`PAGE: ${ctx.title || "(untitled)"} — ${ctx.url}`);
  lines.push(`DEVICE: ${ctx.device ?? "desktop"}`);
  lines.push(`VIEWPORT: ${ctx.viewport.w}x${ctx.viewport.h}`);

  if (ctx.annotations.length) {
    lines.push(`\nHIGHLIGHTED BY THE TESTER (${ctx.annotations.length}) — screenshots follow in order:`);
    for (const a of ctx.annotations) {
      const bits = [`#${a.id} [${a.kind}]`];
      if (a.note) bits.push(`tester's note: "${a.note}"`);
      if (a.selector) bits.push(`selector: ${a.selector}`);
      if (a.domPath) bits.push(`path: ${a.domPath}`);
      if (a.text) bits.push(`text: "${a.text.slice(0, 200)}"`);
      if (a.styles && Object.keys(a.styles).length) {
        bits.push(`styles: ${Object.entries(a.styles).map(([k, v]) => `${k}=${v}`).join(", ")}`);
      }
      bits.push(`box: ${Math.round(a.box.x)},${Math.round(a.box.y)} ${Math.round(a.box.w)}x${Math.round(a.box.h)}`);
      lines.push("- " + bits.join(" | "));
    }
  } else {
    lines.push("\nNo elements were highlighted.");
  }

  if (ctx.steps.length) {
    lines.push(`\nRECORDED ACTIONS (what the tester did to the product, oldest first):`);
    for (const s of ctx.steps.slice(-40)) lines.push(`- [${s.kind}] ${s.text}`);
  } else {
    lines.push("\nNo action log was recorded — infer the minimal reproduction path, and ask if it matters.");
  }

  if (ctx.consoleErrors.length) {
    lines.push(`\nCONSOLE ERRORS:`);
    for (const e of ctx.consoleErrors.slice(-15)) lines.push(`- ${e.slice(0, 300)}`);
  }

  lines.push(`\nUSER AGENT: ${ctx.userAgent}`);

  if (input.hint.trim()) lines.push(`\n=== EXTRA CONTEXT FROM THE TESTER ===\n${input.hint.trim()}`);

  if (input.answers.length) {
    lines.push("\n=== ANSWERS TO YOUR EARLIER QUESTIONS (authoritative) ===");
    for (const a of input.answers) lines.push(`Q: ${a.question}\nA: ${a.answer}`);
  }

  return lines.join("\n");
}

/** Models return JSON with varying discipline — fenced, prefixed with prose, or
 *  clean. Take the outermost brace span and parse that. */
function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("model returned no JSON object");
  return JSON.parse(body.slice(start, end + 1));
}

const SEVERITIES = ["Blocker", "Critical", "Major", "Minor", "Trivial"] as const;

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }

function parseReview(raw: string, fallback: Ticket): Review {
  const p = extractJson(raw) as Record<string, unknown>;
  const questions = Array.isArray(p.questions) ? p.questions : [];
  const critique = Array.isArray(p.critique) ? p.critique : [];
  return {
    draft: {
      summary: str(p.summary) || fallback.summary,
      description: str(p.description) || fallback.description,
      stepsToReproduce: Array.isArray(p.stepsToReproduce) && p.stepsToReproduce.length
        ? p.stepsToReproduce.map(String)
        : fallback.stepsToReproduce,
      expected: str(p.expected) || fallback.expected,
      current: str(p.current) || fallback.current,
      severity: SEVERITIES.includes(p.severity as never)
        ? p.severity as Draft["severity"]
        : fallback.severity,
      labels: Array.isArray(p.labels) ? p.labels.map(String).slice(0, 8) : [],
    },
    critique: critique.slice(0, 6).map((c) => {
      const o = c as Record<string, unknown>;
      return { field: str(o.field), issue: str(o.issue), suggestion: str(o.suggestion) };
    }).filter((c) => c.issue),
    // An id is what the UI keys answers by; models forget it often enough that
    // deriving one is cheaper than a retry.
    questions: questions.slice(0, 4).map((q, i) => {
      const o = q as Record<string, unknown>;
      return {
        id: str(o.id) || `q${i + 1}`,
        question: str(o.question),
        why: str(o.why),
        suggestions: Array.isArray(o.suggestions) ? o.suggestions.map(String).slice(0, 4) : [],
      };
    }).filter((q) => q.question),
    readiness: typeof p.readiness === "number" ? Math.max(0, Math.min(100, Math.round(p.readiness))) : 50,
    // Untrusted: keep only known keys with non-empty values.
    headings: p.headings && typeof p.headings === "object"
      ? pickStrings(p.headings as Partial<TicketStrings>)
      : undefined,
  };
}

/** Screenshots to send. Cropped annotation shots first — they are tight on the
 *  defect — then the annotated full page for layout context. Capped because
 *  each image is a large, slow chunk of context. */
function images(ctx: CaptureContext, limit = 4): string[] {
  const crops = ctx.annotations.map((a) => a.shot).filter((s): s is string => Boolean(s));
  const out = crops.slice(0, limit);
  if (ctx.pageShot && out.length < limit) out.push(ctx.pageShot);
  return out;
}

export async function review(
  s: AppSettings, ctx: CaptureContext, input: ReviewInput,
): Promise<Result<Review>> {
  const { endpoint, apiKey, model, vision } = s.llm;
  if (!endpoint || !model) return { ok: false, error: "LLM endpoint and model are not configured." };

  const questionLang = langName(s.llm.questionLang);
  const ticketLang = langName(s.llm.ticketLang);
  // Only ask for headings when we cannot supply them ourselves and have not
  // already cached them — it is a chunk of output on every single review.
  const needHeadings = !hasBuiltInStrings(ticketLang)
    && !s.llm.headings?.[ticketLang.trim().toLowerCase()];

  const text = digest(ctx, input);
  const shots = vision ? images(ctx) : [];

  const content: unknown = shots.length
    ? [
      { type: "text", text },
      ...shots.map((url) => ({ type: "image_url", image_url: { url } })),
    ]
    : text;

  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system(questionLang, ticketLang, needHeadings) },
          { role: "user", content },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}` };
    }
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? "";
    return { ok: true, data: parseReview(raw, input.ticket) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
