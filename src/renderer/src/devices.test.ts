import { describe, expect, it } from "vitest";
import {
  DEVICES, DEVICE_GROUPS, FIT, deviceById, describeDevice, fitScale, orient, userAgentFor,
} from "./devices.js";

describe("device catalogue", () => {
  it("has unique ids", () => {
    const ids = DEVICES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts every device in a known group", () => {
    for (const d of DEVICES) expect(DEVICE_GROUPS).toContain(d.group as never);
  });

  it("covers phones, tablets, laptops and monitors", () => {
    for (const g of DEVICE_GROUPS) {
      expect(DEVICES.filter((d) => d.group === g).length).toBeGreaterThan(2);
    }
  });

  it("stores logical CSS pixels, not marketing resolutions", () => {
    // A 15" MacBook Air advertises 2880×1864 but lays out at 1440×932 — testing
    // against the panel resolution would fire the wrong media queries.
    expect(deviceById("mba-15").w).toBe(1440);
    expect(deviceById("iphone-15").w).toBe(393);
  });

  it("falls back to fit for an unknown id", () => {
    expect(deviceById("nope").id).toBe(FIT.id);
  });
});

describe("orient", () => {
  it("swaps the axes for landscape", () => {
    const d = orient(deviceById("iphone-15"), "landscape");
    expect([d.w, d.h]).toEqual([852, 393]);
  });

  it("leaves portrait alone", () => {
    const d = orient(deviceById("iphone-15"), "portrait");
    expect([d.w, d.h]).toEqual([393, 852]);
  });

  it("never rotates the fit pseudo-device", () => {
    expect(orient(FIT, "landscape")).toEqual(FIT);
  });
});

describe("fitScale", () => {
  it("is 1 when the device fits", () => {
    expect(fitScale(deviceById("iphone-15"), { w: 1000, h: 1000 })).toBe(1);
  });

  it("shrinks to the tighter axis", () => {
    // 1920 wide into 960 = 0.5; 1080 tall into 810 = 0.75 — width binds.
    expect(fitScale(deviceById("mon-1080"), { w: 960, h: 810 })).toBeCloseTo(0.5);
  });

  it("never scales up — a 375px phone blown up would misrepresent it", () => {
    expect(fitScale(deviceById("iphone-se"), { w: 4000, h: 4000 })).toBe(1);
  });

  it("is 1 for fit, and safe before the stage has been measured", () => {
    expect(fitScale(FIT, { w: 800, h: 600 })).toBe(1);
    expect(fitScale(deviceById("iphone-15"), { w: 0, h: 0 })).toBe(1);
  });
});

describe("describeDevice", () => {
  it("reads as a reproducible environment line", () => {
    expect(describeDevice(deviceById("iphone-15"), "portrait"))
      .toBe("iPhone 15 / 14 Pro — 393×852 @3x (portrait)");
  });

  it("reflects rotation", () => {
    expect(describeDevice(deviceById("ipad-pro-11"), "landscape"))
      .toContain("1210×834");
  });

  it("omits the dpr suffix at 1x", () => {
    expect(describeDevice(deviceById("mon-1080"), "portrait")).not.toContain("@");
  });

  it("reports the real window size when no device is emulated", () => {
    expect(describeDevice(FIT, "portrait", { w: 1512, h: 860 }))
      .toBe("Desktop window — 1512×860");
  });
});

describe("userAgentFor", () => {
  it("serves a desktop UA for desktop-class devices", () => {
    expect(userAgentFor(deviceById("mba-13"))).toBeNull();
    expect(userAgentFor(deviceById("mon-4k"))).toBeNull();
  });

  it("serves the matching mobile UA so UA-sniffing sites behave", () => {
    expect(userAgentFor(deviceById("iphone-15"))).toContain("iPhone");
    expect(userAgentFor(deviceById("ipad-pro-11"))).toContain("iPad");
    expect(userAgentFor(deviceById("galaxy-s24"))).toContain("Android");
  });
});
