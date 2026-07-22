// Device presets for responsive testing.
//
// Every size here is CSS/logical pixels — the number that actually decides which
// media query fires — not the marketing resolution. A 15" MacBook Air advertises
// 2880×1864 but lays out at 1440×932, and testing against 2880 would be wrong.
// `dpr` is carried separately so the ticket can say "@2x" and so retina-only
// defects (blurry assets, hairline borders) are attributable.

export interface Device {
  id: string;
  name: string;
  group: string;
  /** Logical width in CSS px, portrait for handhelds. */
  w: number;
  h: number;
  dpr: number;
  /** Serve a mobile user-agent and treat the viewport as touch-capable. */
  mobile: boolean;
}

/** Fills the available panel — the default, and what you want most of the time. */
export const FIT: Device = { id: "fit", name: "Fit to window", group: "", w: 0, h: 0, dpr: 1, mobile: false };

export const DEVICES: Device[] = [
  // ── Phones ────────────────────────────────────────────────────────────────
  { id: "iphone-se", name: 'iPhone SE (4.7")', group: "Phones", w: 375, h: 667, dpr: 2, mobile: true },
  { id: "iphone-13-mini", name: "iPhone 13 mini", group: "Phones", w: 375, h: 812, dpr: 3, mobile: true },
  { id: "iphone-15", name: "iPhone 15 / 14 Pro", group: "Phones", w: 393, h: 852, dpr: 3, mobile: true },
  { id: "iphone-16", name: "iPhone 16 / 16 Pro", group: "Phones", w: 402, h: 874, dpr: 3, mobile: true },
  { id: "iphone-16-pro-max", name: "iPhone 16 Pro Max", group: "Phones", w: 440, h: 956, dpr: 3, mobile: true },
  { id: "iphone-15-plus", name: "iPhone 15 Plus / Pro Max", group: "Phones", w: 430, h: 932, dpr: 3, mobile: true },
  { id: "galaxy-s24", name: "Samsung Galaxy S24", group: "Phones", w: 360, h: 780, dpr: 3, mobile: true },
  { id: "galaxy-s24-ultra", name: "Samsung Galaxy S24 Ultra", group: "Phones", w: 384, h: 824, dpr: 3.5, mobile: true },
  { id: "galaxy-a54", name: "Samsung Galaxy A54", group: "Phones", w: 360, h: 800, dpr: 3, mobile: true },
  { id: "pixel-8", name: "Google Pixel 8", group: "Phones", w: 412, h: 915, dpr: 2.6, mobile: true },
  { id: "pixel-8-pro", name: "Google Pixel 8 Pro", group: "Phones", w: 448, h: 998, dpr: 2.6, mobile: true },
  { id: "oneplus-12", name: "OnePlus 12", group: "Phones", w: 412, h: 919, dpr: 3, mobile: true },
  { id: "fold-closed", name: "Galaxy Z Fold (closed)", group: "Phones", w: 344, h: 882, dpr: 3, mobile: true },
  { id: "fold-open", name: "Galaxy Z Fold (open)", group: "Phones", w: 673, h: 841, dpr: 2.6, mobile: true },

  // ── Tablets ───────────────────────────────────────────────────────────────
  { id: "ipad-mini", name: 'iPad mini (8.3")', group: "Tablets", w: 744, h: 1133, dpr: 2, mobile: true },
  { id: "ipad-10", name: 'iPad (10.9")', group: "Tablets", w: 820, h: 1180, dpr: 2, mobile: true },
  { id: "ipad-air-11", name: 'iPad Air (11")', group: "Tablets", w: 820, h: 1180, dpr: 2, mobile: true },
  { id: "ipad-pro-11", name: 'iPad Pro (11")', group: "Tablets", w: 834, h: 1210, dpr: 2, mobile: true },
  { id: "ipad-pro-13", name: 'iPad Pro (13")', group: "Tablets", w: 1024, h: 1366, dpr: 2, mobile: true },
  { id: "galaxy-tab-s9", name: "Samsung Galaxy Tab S9", group: "Tablets", w: 800, h: 1280, dpr: 2.4, mobile: true },
  { id: "surface-pro", name: "Surface Pro 9", group: "Tablets", w: 912, h: 1368, dpr: 2, mobile: false },

  // ── Laptops ───────────────────────────────────────────────────────────────
  { id: "mba-13", name: 'MacBook Air 13"', group: "Laptops", w: 1280, h: 800, dpr: 2, mobile: false },
  { id: "mbp-14", name: 'MacBook Pro 14"', group: "Laptops", w: 1512, h: 982, dpr: 2, mobile: false },
  { id: "mba-15", name: 'MacBook Air 15"', group: "Laptops", w: 1440, h: 932, dpr: 2, mobile: false },
  { id: "mbp-16", name: 'MacBook Pro 16"', group: "Laptops", w: 1728, h: 1117, dpr: 2, mobile: false },
  { id: "laptop-hd", name: "Windows laptop (1366×768)", group: "Laptops", w: 1366, h: 768, dpr: 1, mobile: false },
  { id: "laptop-fhd", name: "Windows laptop (1920×1080)", group: "Laptops", w: 1920, h: 1080, dpr: 1, mobile: false },
  { id: "surface-laptop", name: "Surface Laptop", group: "Laptops", w: 1500, h: 1000, dpr: 2, mobile: false },
  { id: "xps-13", name: "Dell XPS 13", group: "Laptops", w: 1280, h: 800, dpr: 2, mobile: false },
  { id: "chromebook", name: "Chromebook (1366×768)", group: "Laptops", w: 1366, h: 768, dpr: 1, mobile: false },

  // ── Monitors ──────────────────────────────────────────────────────────────
  { id: "mon-1080", name: "1080p monitor", group: "Monitors", w: 1920, h: 1080, dpr: 1, mobile: false },
  { id: "mon-1440", name: "1440p / QHD monitor", group: "Monitors", w: 2560, h: 1440, dpr: 1, mobile: false },
  { id: "mon-4k", name: "4K monitor (unscaled)", group: "Monitors", w: 3840, h: 2160, dpr: 1, mobile: false },
  { id: "mon-studio", name: 'Studio Display 27" (@2x)', group: "Monitors", w: 2560, h: 1440, dpr: 2, mobile: false },
  { id: "mon-ultrawide", name: "Ultrawide (3440×1440)", group: "Monitors", w: 3440, h: 1440, dpr: 1, mobile: false },
  { id: "mon-1280", name: "Small monitor (1280×1024)", group: "Monitors", w: 1280, h: 1024, dpr: 1, mobile: false },
];

export const DEVICE_GROUPS = ["Phones", "Tablets", "Laptops", "Monitors"] as const;

export function deviceById(id: string): Device {
  return DEVICES.find((d) => d.id === id) ?? FIT;
}

/** Swap width and height for landscape. Only meaningful for handhelds, but
 *  harmless elsewhere — a rotated monitor is a real (if rare) setup. */
export function orient(d: Device, orientation: "portrait" | "landscape"): Device {
  if (orientation === "portrait" || d.id === FIT.id) return d;
  return { ...d, w: d.h, h: d.w };
}

/** Scale needed to fit the device frame inside the available panel. Never scales
 *  up — a 375px phone shown at 200% would misrepresent what the tester sees. */
export function fitScale(d: Device, available: { w: number; h: number }): number {
  if (d.id === FIT.id || !available.w || !available.h) return 1;
  return Math.min(1, available.w / d.w, available.h / d.h);
}

/** How the device reads in a ticket: "iPhone 15 — 393×852 @3x (portrait)". */
export function describeDevice(
  d: Device, orientation: "portrait" | "landscape", actual?: { w: number; h: number },
): string {
  if (d.id === FIT.id) {
    return actual ? `Desktop window — ${actual.w}×${actual.h}` : "Desktop window";
  }
  const o = orient(d, orientation);
  const dpr = o.dpr === 1 ? "" : ` @${o.dpr}x`;
  const rot = d.w === d.h ? "" : ` (${orientation})`;
  return `${d.name} — ${o.w}×${o.h}${dpr}${rot}`;
}

// Chrome's own emulation strings, so a site that sniffs the UA serves the same
// thing it would to the real device.
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

/** The user agent this device should present, or null to keep the desktop one. */
export function userAgentFor(d: Device): string | null {
  if (!d.mobile) return null;
  if (d.id.startsWith("ipad")) return IPAD_UA;
  if (d.id.startsWith("iphone")) return IOS_UA;
  return ANDROID_UA;
}
