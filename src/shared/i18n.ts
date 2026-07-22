// Localisation for the text the tool writes itself.
//
// Two independent languages, because they serve different readers: the AI's
// questions and critique are read by the tester, while the ticket is read by
// whoever picks up the bug. A Vietnamese tester on an English-speaking team
// wants to be asked in Vietnamese and to file in English — so the two settings
// never derive from each other.
//
// A language is a free-form NAME ("English", "Tiếng Việt", "日本語"), not a code:
// models resolve names far more reliably than ISO codes, and it lets the tester
// pick anything at all. Only text WE generate is translated here; the model is
// instructed separately, and the page under test is never translated.

export type Lang = string;

/** Offered in the pickers. The field stays free-text, so this is a convenience
 *  list, not a limit. */
export const LANGS: string[] = [
  "English", "Tiếng Việt", "日本語", "한국어", "中文 (简体)", "中文 (繁體)",
  "Español", "Français", "Deutsch", "Português (Brasil)", "Italiano", "Nederlands",
  "Bahasa Indonesia", "Bahasa Melayu", "ไทย", "Filipino", "हिन्दी", "বাংলা",
  "Русский", "Українська", "Polski", "Türkçe", "العربية", "עברית", "Svenska",
  "Norsk", "Dansk", "Suomi", "Čeština", "Ελληνικά", "Română", "Magyar",
];

export const DEFAULT_LANG = "English";

/** What we send the model. Falls back to English rather than an empty string,
 *  which would otherwise read as "no instruction" and give unpredictable output. */
export function langName(lang: Lang): string {
  return (lang || "").trim() || DEFAULT_LANG;
}

// ---------------------------------------------------------------------------
// Ticket body
// ---------------------------------------------------------------------------

export interface TicketStrings {
  steps: string;
  expected: string;
  current: string;
  domReference: string;
  consoleOutput: string;
  environment: string;
  screenshots: string;
  notSpecified: string;
  region: string;
  observed: string;
  domPath: string;
  text: string;
  attributes: string;
  computed: string;
  url: string;
  pageTitle: string;
  device: string;
  viewport: string;
  userAgent: string;
  severity: string;
  notes: string;
  untitled: string;
  desktopWindow: string;
  /** `%s` is the URL. */
  openStep: string;
  /** `%s` is the reporter's name. */
  filedBy: string;
  filed: string;
}

const EN: TicketStrings = {
  steps: "Steps to reproduce",
  expected: "Expected behaviour",
  current: "Current behaviour",
  domReference: "DOM reference",
  consoleOutput: "Console output",
  environment: "Environment",
  screenshots: "Screenshots",
  notSpecified: "_Not specified._",
  region: "Region",
  observed: "Observed",
  domPath: "DOM path",
  text: "Text",
  attributes: "Attributes",
  computed: "Computed",
  url: "URL",
  pageTitle: "Page title",
  device: "Device",
  viewport: "Viewport",
  userAgent: "User agent",
  severity: "Severity",
  notes: "Notes",
  untitled: "(untitled)",
  desktopWindow: "Desktop window",
  openStep: "Open %s",
  filedBy: "Filed with Redstone Tester by %s.",
  filed: "Filed with Redstone Tester.",
};

const VI: TicketStrings = {
  steps: "Các bước tái hiện",
  expected: "Kết quả mong đợi",
  current: "Kết quả hiện tại",
  domReference: "Tham chiếu DOM",
  consoleOutput: "Nhật ký console",
  environment: "Môi trường",
  screenshots: "Ảnh chụp màn hình",
  notSpecified: "_Chưa cung cấp._",
  region: "Vùng",
  observed: "Ghi nhận",
  domPath: "Đường dẫn DOM",
  text: "Nội dung",
  attributes: "Thuộc tính",
  computed: "Style tính toán",
  url: "URL",
  pageTitle: "Tiêu đề trang",
  device: "Thiết bị",
  viewport: "Khung nhìn",
  userAgent: "User agent",
  severity: "Mức độ nghiêm trọng",
  notes: "Ghi chú",
  untitled: "(không có tiêu đề)",
  desktopWindow: "Cửa sổ máy tính",
  openStep: "Mở %s",
  filedBy: "Tạo bằng Redstone Tester bởi %s.",
  filed: "Tạo bằng Redstone Tester.",
};

/** Hand-verified translations. Every other language gets its headings from the
 *  model (see `headings` in the AI review) — shipping machine translations for
 *  languages nobody here can check would be worse than falling back. */
const BUILT_IN: Record<string, TicketStrings> = {
  english: EN, en: EN,
  "tiếng việt": VI, "tieng viet": VI, vietnamese: VI, vi: VI,
};

export function normalizeLang(lang: Lang): string {
  return (lang || "").trim().toLowerCase();
}

export function hasBuiltInStrings(lang: Lang): boolean {
  return Boolean(BUILT_IN[normalizeLang(lang)]);
}

/**
 * Section headings for a ticket.
 *
 * Built-in translations win. For any other language the model supplies headings
 * during a review and they are cached in settings; until then we fall back to
 * English, which reads better than a half-translated ticket.
 */
export function ticketStrings(lang: Lang, cached?: Partial<TicketStrings>): TicketStrings {
  const built = BUILT_IN[normalizeLang(lang)];
  if (built) return built;
  return cached ? { ...EN, ...pickStrings(cached) } : EN;
}

/** Keep only known keys with non-empty string values — the cache can come from a
 *  model, so it is untrusted input. */
export function pickStrings(input: Partial<TicketStrings>): Partial<TicketStrings> {
  const out: Partial<TicketStrings> = {};
  for (const key of Object.keys(EN) as Array<keyof TicketStrings>) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

/** The heading keys the model is asked to translate. Deliberately excludes the
 *  placeholder-bearing ones (`openStep`, `filedBy`) — a model that drops the
 *  `%s` would silently lose the URL or the name. */
export const TRANSLATABLE: Array<keyof TicketStrings> = [
  "steps", "expected", "current", "domReference", "consoleOutput", "environment",
  "screenshots", "region", "observed", "domPath", "text", "attributes", "computed",
  "url", "pageTitle", "device", "viewport", "userAgent", "severity", "notes",
];

/** Fill a single `%s` placeholder. */
export function fill(template: string, value: string): string {
  return template.replace("%s", value);
}

// ---------------------------------------------------------------------------
// Step recorder (runs inside the guest, so this ships as data)
// ---------------------------------------------------------------------------

export interface RecorderPhrases {
  open: string;
  /** Prefix before the control's role: "Click the" / "Nhấp vào". */
  click: string;
  enter: string;
  into: string;
  check: string;
  uncheck: string;
  submit: string;
  redacted: string;
  /** `%s` is the placeholder text: `the "Email" field`. */
  fieldOf: string;
  /** `%s` is a tag name: `the div`. */
  theTag: string;
  roles: { link: string; button: string; field: string };
}

const EN_REC: RecorderPhrases = {
  open: "Open",
  click: "Click the",
  enter: "Enter",
  into: "into",
  check: "Check",
  uncheck: "Uncheck",
  submit: "Submit",
  redacted: "(redacted)",
  fieldOf: 'the "%s" field',
  theTag: "the %s",
  roles: { link: "link", button: "button", field: "field" },
};

const VI_REC: RecorderPhrases = {
  open: "Mở",
  click: "Nhấp vào",
  enter: "Nhập",
  into: "vào",
  check: "Chọn",
  uncheck: "Bỏ chọn",
  submit: "Gửi",
  redacted: "(đã ẩn)",
  fieldOf: 'trường "%s"',
  theTag: "%s",
  roles: { link: "liên kết", button: "nút", field: "trường" },
};

const BUILT_IN_REC: Record<string, RecorderPhrases> = {
  english: EN_REC, en: EN_REC,
  "tiếng việt": VI_REC, "tieng viet": VI_REC, vietnamese: VI_REC, vi: VI_REC,
};

/** Phrases for the live step recorder. Recording happens before any model call,
 *  so unknown languages record in English; the AI rewrite then translates the
 *  steps into the ticket language. */
export function recorderPhrases(lang: Lang): RecorderPhrases {
  return BUILT_IN_REC[normalizeLang(lang)] ?? EN_REC;
}
