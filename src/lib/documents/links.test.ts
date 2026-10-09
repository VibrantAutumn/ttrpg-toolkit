import { describe, expect, it } from "vitest";
import { canOpenExternally, normalizeLinkAddress } from "./links";

describe("normalizeLinkAddress", () => {
  it("leaves a full address alone", () => {
    expect(normalizeLinkAddress("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeLinkAddress("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("adds https:// to a bare web address", () => {
    expect(normalizeLinkAddress("example.com")).toBe("https://example.com");
    expect(normalizeLinkAddress("www.example.com/page")).toBe("https://www.example.com/page");
  });

  it("makes an email address a mailto link", () => {
    expect(normalizeLinkAddress("me@example.com")).toBe("mailto:me@example.com");
  });

  it("keeps in-page and relative addresses", () => {
    expect(normalizeLinkAddress("#section")).toBe("#section");
    expect(normalizeLinkAddress("/notes/1")).toBe("/notes/1");
  });

  it("trims spaces and gives an empty answer for nothing", () => {
    expect(normalizeLinkAddress("  example.com  ")).toBe("https://example.com");
    expect(normalizeLinkAddress("   ")).toBe("");
  });
});

describe("canOpenExternally", () => {
  it("allows web, mail and phone addresses only", () => {
    expect(canOpenExternally("https://example.com")).toBe(true);
    expect(canOpenExternally("HTTP://example.com")).toBe(true);
    expect(canOpenExternally("mailto:a@b.com")).toBe(true);
    expect(canOpenExternally("javascript:alert(1)")).toBe(false);
    expect(canOpenExternally("file:///C:/secret")).toBe(false);
    expect(canOpenExternally("#section")).toBe(false);
  });
});
