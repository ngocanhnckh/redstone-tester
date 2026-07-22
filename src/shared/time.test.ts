import { describe, expect, it } from "vitest";
import { fileSize, relTime } from "./time.js";

const NOW = Date.parse("2026-07-22T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relTime", () => {
  it("reads as 'just now' inside the first minute", () => {
    expect(relTime(ago(5_000), NOW)).toBe("just now");
  });

  it("counts minutes, hours and days", () => {
    expect(relTime(ago(9 * 60_000), NOW)).toBe("9m ago");
    expect(relTime(ago(3 * 3_600_000), NOW)).toBe("3h ago");
    expect(relTime(ago(2 * 86_400_000), NOW)).toBe("2d ago");
  });

  it("switches to a date past a week, where '47d ago' would mean nothing", () => {
    expect(relTime("2026-03-12T09:00:00Z", NOW)).toBe("12 Mar");
  });

  it("shows the year only when it is not the current one", () => {
    expect(relTime("2025-11-03T09:00:00Z", NOW)).toBe("3 Nov 2025");
  });

  it("handles a future timestamp — clock skew between Jira and this machine is real", () => {
    expect(relTime(ago(-2 * 3_600_000), NOW)).toBe("in 2h");
  });

  it("returns nothing for a missing or unparseable value rather than 'NaN ago'", () => {
    expect(relTime(undefined, NOW)).toBe("");
    expect(relTime("", NOW)).toBe("");
    expect(relTime("not a date", NOW)).toBe("");
  });
});

describe("fileSize", () => {
  it("scales the unit to the size", () => {
    expect(fileSize(512)).toBe("512 B");
    expect(fileSize(2048)).toBe("2 KB");
    expect(fileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("says nothing for a missing size instead of '0 B'", () => {
    expect(fileSize(0)).toBe("");
  });
});
