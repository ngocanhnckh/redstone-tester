import { describe, it, expect } from "vitest";
import { jiraToPlain, markdownToJira } from "./jiraMarkup";

describe("markdownToJira", () => {
  it("empty / whitespace → empty string", () => {
    expect(markdownToJira("")).toBe("");
    expect(markdownToJira("   \n  ")).toBe("");
  });

  it("headings map # → h1. .. h6.", () => {
    expect(markdownToJira("# Title")).toBe("h1. Title");
    expect(markdownToJira("### Sub")).toBe("h3. Sub");
  });

  it("bold **x** and __x__ → *x*", () => {
    expect(markdownToJira("a **bold** b")).toBe("a *bold* b");
    expect(markdownToJira("__strong__")).toBe("*strong*");
  });

  it("italic *x* and _x_ → _x_ (and does not corrupt bold)", () => {
    expect(markdownToJira("an *italic* word")).toBe("an _italic_ word");
    expect(markdownToJira("_already_")).toBe("_already_");
    // bold must not be turned into italic
    expect(markdownToJira("**b** and *i*")).toBe("*b* and _i_");
  });

  it("inline code → {{ }} and passes its contents through untouched", () => {
    expect(markdownToJira("run `npm **install**` now")).toBe("run {{npm **install**}} now");
  });

  it("links [t](u) → [t|u]", () => {
    expect(markdownToJira("see [docs](https://x.com/a)")).toBe("see [docs|https://x.com/a]");
  });

  it("bullet lists → * with nesting by indent", () => {
    expect(markdownToJira("- one\n- two")).toBe("* one\n* two");
    expect(markdownToJira("- top\n  - nested")).toBe("* top\n** nested");
  });

  it("numbered lists → # with nesting", () => {
    expect(markdownToJira("1. first\n2. second")).toBe("# first\n# second");
    expect(markdownToJira("1. top\n   1. child")).toBe("# top\n## child");
  });

  it("blockquote → bq. and hr → ----", () => {
    expect(markdownToJira("> quoted")).toBe("bq. quoted");
    expect(markdownToJira("---")).toBe("----");
  });

  it("fenced code block → {code:lang} … {code}", () => {
    expect(markdownToJira("```js\nconst x = 1;\n```")).toBe("{code:js}\nconst x = 1;\n{code}");
    expect(markdownToJira("```\nplain\n```")).toBe("{code}\nplain\n{code}");
  });

  it("fenced code contents are NOT emphasis/link converted", () => {
    expect(markdownToJira("```\na **b** [c](d)\n```")).toBe("{code}\na **b** [c](d)\n{code}");
  });

  it("strikethrough ~~x~~ → -x-", () => {
    expect(markdownToJira("~~gone~~")).toBe("-gone-");
  });

  it("a realistic mixed document", () => {
    const md = [
      "# Plan",
      "",
      "Ship the **login** flow and fix `authGuard`.",
      "",
      "- step one",
      "- step [two](https://j/RCW-2)",
    ].join("\n");
    expect(markdownToJira(md)).toBe(
      ["h1. Plan", "", "Ship the *login* flow and fix {{authGuard}}.", "", "* step one", "* step [two|https://j/RCW-2]"].join("\n"),
    );
  });
});

describe("jiraToPlain", () => {
  it("turns a heading into a plain line, not 'h3. Heading'", () => {
    expect(jiraToPlain("h3. Steps to reproduce")).toBe("Steps to reproduce");
  });

  it("renders lists as bullets regardless of nesting depth", () => {
    expect(jiraToPlain("* one\n** two\n# three")).toBe("• one\n• two\n• three");
  });

  it("drops emphasis markers", () => {
    expect(jiraToPlain("this is *bold* and _italic_ and +inserted+"))
      .toBe("this is bold and italic and inserted");
  });

  it("leaves arithmetic and identifiers alone", () => {
    // A naive strip would eat the stars in 2*3*4 and the underscores in a
    // filename, which is exactly the text a bug report is full of.
    expect(jiraToPlain("2*3*4 = 24")).toBe("2*3*4 = 24");
    expect(jiraToPlain("see file_name_1.png")).toBe("see file_name_1.png");
  });

  it("names an attached image instead of showing the macro", () => {
    expect(jiraToPlain("Before !shot.png|thumbnail! after")).toBe("Before [shot.png] after");
  });

  it("keeps both halves of a link", () => {
    expect(jiraToPlain("see [the page|https://x.test/a] now"))
      .toBe("see the page (https://x.test/a) now");
  });

  it("preserves a code block byte for byte", () => {
    // A stack trace is evidence. Anything that looks like markup inside it —
    // *pointers, _names, [brackets] — must survive untouched.
    const wiki = "before\n{code}\nat *foo* _bar_ [baz]\n{code}\nafter";
    expect(jiraToPlain(wiki)).toBe("before\nat *foo* _bar_ [baz]\nafter");
  });

  it("preserves noformat blocks the same way", () => {
    expect(jiraToPlain("{noformat}\nh1. not a heading\n{noformat}")).toBe("h1. not a heading");
  });

  it("strips inline code delimiters", () => {
    expect(jiraToPlain("run {{npm test}} first")).toBe("run npm test first");
  });

  it("returns an empty string for empty input rather than throwing", () => {
    expect(jiraToPlain("")).toBe("");
    expect(jiraToPlain("   ")).toBe("");
  });
});
