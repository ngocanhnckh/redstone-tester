import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANG, LANGS, TRANSLATABLE, hasBuiltInStrings, langName, pickStrings,
  recorderPhrases, ticketStrings,
} from "./i18n.js";
import { ticketMarkdown } from "./ticketFormat.js";
import type { CaptureContext, Ticket } from "./types.js";

describe("langName", () => {
  it("passes a language name through", () => {
    expect(langName("Tiếng Việt")).toBe("Tiếng Việt");
    expect(langName("日本語")).toBe("日本語");
  });

  it("falls back to English rather than sending an empty instruction", () => {
    // An empty language in the prompt reads as "no instruction" and the output
    // language becomes whatever the model feels like.
    expect(langName("")).toBe(DEFAULT_LANG);
    expect(langName("   ")).toBe(DEFAULT_LANG);
  });
});

describe("built-in translations", () => {
  it("recognises English and Vietnamese under several spellings", () => {
    for (const l of ["English", "en", "Tiếng Việt", "tieng viet", "Vietnamese", "VI"]) {
      expect(hasBuiltInStrings(l)).toBe(true);
    }
  });

  it("reports no built-in for other languages", () => {
    for (const l of ["日本語", "Español", "Klingon", ""]) {
      expect(hasBuiltInStrings(l)).toBe(false);
    }
  });

  it("translates the Vietnamese headings", () => {
    const vi = ticketStrings("Tiếng Việt");
    expect(vi.steps).toBe("Các bước tái hiện");
    expect(vi.expected).toBe("Kết quả mong đợi");
    expect(vi.openStep).toContain("%s");
  });

  it("offers a broad preset list including non-Latin scripts", () => {
    expect(LANGS).toContain("English");
    expect(LANGS).toContain("Tiếng Việt");
    expect(LANGS.some((l) => /[぀-ヿ一-鿿]/.test(l))).toBe(true);
    expect(LANGS.some((l) => /[؀-ۿ]/.test(l))).toBe(true);
  });
});

describe("model-supplied headings", () => {
  it("falls back to English for an unknown language with no cache", () => {
    expect(ticketStrings("日本語").steps).toBe("Steps to reproduce");
  });

  it("uses cached headings when present", () => {
    const out = ticketStrings("日本語", { steps: "再現手順", expected: "期待される動作" });
    expect(out.steps).toBe("再現手順");
    expect(out.expected).toBe("期待される動作");
    // Anything the model omitted still falls back rather than going blank.
    expect(out.current).toBe("Current behaviour");
  });

  it("built-ins win over a cache — a verified translation beats a generated one", () => {
    expect(ticketStrings("Tiếng Việt", { steps: "nonsense" }).steps).toBe("Các bước tái hiện");
  });

  it("rejects junk from the model", () => {
    const cleaned = pickStrings({
      steps: "  再現手順  ",
      expected: "",
      current: 42 as unknown as string,
      bogusKey: "x",
    } as never);
    expect(cleaned).toEqual({ steps: "再現手順" });
  });

  it("never asks the model to translate placeholder-bearing strings", () => {
    // A model that drops the %s would silently lose the URL or the tester's name.
    expect(TRANSLATABLE).not.toContain("openStep");
    expect(TRANSLATABLE).not.toContain("filedBy");
  });
});

describe("recorder phrases", () => {
  it("localises the verbs it records with", () => {
    expect(recorderPhrases("Tiếng Việt").click).toBe("Nhấp vào");
    expect(recorderPhrases("Tiếng Việt").roles.button).toBe("nút");
    expect(recorderPhrases("English").click).toBe("Click the");
  });

  it("records in English for a language it cannot phrase, rather than breaking", () => {
    // Recording happens before any model call; the AI rewrite translates later.
    expect(recorderPhrases("日本語").click).toBe("Click the");
  });
});

// ---------------------------------------------------------------------------

const ctx: CaptureContext = {
  url: "https://shop.test/cart",
  title: "Cart",
  annotations: [{
    id: 1, kind: "element", note: "Giá hiển thị là NaN",
    selector: "#total", domPath: "main > span#total", tag: "span",
    attrs: { id: "total" }, text: "$NaN", styles: { color: "rgb(220,38,38)" },
    box: { x: 0, y: 0, w: 80, h: 20 }, vw: 1280, vh: 800, url: "https://shop.test/cart",
  }],
  steps: [],
  viewport: { w: 1280, h: 800 },
  userAgent: "Chrome/130",
  consoleErrors: ["TypeError: x"],
};

const ticket: Ticket = {
  summary: "Tổng giỏ hàng hiển thị NaN",
  description: "Khách không biết phải trả bao nhiêu.",
  stepsToReproduce: ["Mở https://shop.test/", "Thêm sản phẩm vào giỏ"],
  expected: "Tổng tiền bằng tổng các dòng hàng.",
  current: "Tổng tiền hiển thị $NaN.",
  severity: "Critical",
  environment: "",
  labels: [],
};

describe("ticketMarkdown language", () => {
  it("writes every heading in the ticket language", () => {
    const md = ticketMarkdown(ticket, ctx, { lang: "Tiếng Việt", tester: "Anh" });
    expect(md).toContain("## Các bước tái hiện");
    expect(md).toContain("## Kết quả mong đợi");
    expect(md).toContain("## Kết quả hiện tại");
    expect(md).toContain("## Tham chiếu DOM");
    expect(md).toContain("## Môi trường");
    expect(md).toContain("Tạo bằng Redstone Tester bởi Anh.");
    // No English heading may survive, or the ticket reads half-translated.
    expect(md).not.toContain("## Steps to reproduce");
    expect(md).not.toContain("## Environment");
  });

  it("keeps the machine-readable evidence untranslated", () => {
    const md = ticketMarkdown(ticket, ctx, { lang: "Tiếng Việt" });
    expect(md).toContain("`#total`");
    expect(md).toContain("main > span#total");
    expect(md).toContain("https://shop.test/cart");
    // Severity is a Jira field, not prose — the value stays English even though
    // its label is translated.
    expect(md).toContain("Mức độ nghiêm trọng: Critical");
  });

  it("defaults to English when no language is given", () => {
    expect(ticketMarkdown(ticket, ctx, {})).toContain("## Steps to reproduce");
  });

  it("uses cached headings for a language with no built-in", () => {
    const md = ticketMarkdown(ticket, ctx, {
      lang: "日本語",
      headings: { steps: "再現手順", environment: "環境" },
    });
    expect(md).toContain("## 再現手順");
    expect(md).toContain("## 環境");
    expect(md).toContain("## Expected behaviour"); // not supplied → English
  });

  it("localises the fallback step when nothing was recorded", () => {
    const md = ticketMarkdown({ ...ticket, stepsToReproduce: [] }, ctx, { lang: "Tiếng Việt" });
    expect(md).toContain("1. Mở https://shop.test/cart");
  });
});
