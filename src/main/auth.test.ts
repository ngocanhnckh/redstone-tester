import { describe, expect, it } from "vitest";
import { authKey, displayOrigin } from "./auth.js";

describe("authKey", () => {
  it("ignores the path — credentials satisfy an origin, not a page", () => {
    const a = authKey("https://staging.example.com/admin/users?page=2", "Staging", false);
    const b = authKey("https://staging.example.com/", "Staging", false);
    expect(a).toBe(b);
  });

  it("separates ports — :8443 is a different app from :443", () => {
    expect(authKey("https://app.test:8443/", "r", false))
      .not.toBe(authKey("https://app.test/", "r", false));
  });

  it("separates schemes and hosts", () => {
    expect(authKey("http://app.test/", "r", false))
      .not.toBe(authKey("https://app.test/", "r", false));
    expect(authKey("https://a.test/", "r", false))
      .not.toBe(authKey("https://b.test/", "r", false));
  });

  it("separates realms on one origin", () => {
    expect(authKey("https://app.test/", "Staging", false))
      .not.toBe(authKey("https://app.test/", "Admin", false));
  });

  it("treats a missing realm as its own stable key", () => {
    expect(authKey("https://app.test/", "", false))
      .toBe(authKey("https://app.test/other", "", false));
  });

  it("never lets a proxy credential satisfy a site challenge", () => {
    // Same string, different meaning: sending the proxy password to the origin
    // (or vice versa) would leak one credential to the other party.
    expect(authKey("proxy.corp:3128", "", true))
      .not.toBe(authKey("proxy.corp:3128", "", false));
  });

  it("survives the bare host:port a proxy reports", () => {
    expect(() => authKey("proxy.corp:3128", "corp", true)).not.toThrow();
    expect(authKey("proxy.corp:3128", "corp", true)).toContain("proxy.corp:3128");
  });
});

describe("displayOrigin", () => {
  it("shows the origin the tester is being asked to trust, without the path", () => {
    expect(displayOrigin("https://staging.example.com/deep/link?token=abc"))
      .toBe("https://staging.example.com");
  });

  it("keeps a non-default port visible", () => {
    expect(displayOrigin("http://localhost:8080/x")).toBe("http://localhost:8080");
  });

  it("falls back to the raw string rather than throwing", () => {
    expect(displayOrigin("proxy.corp:3128")).toBe("proxy.corp:3128");
  });
});
