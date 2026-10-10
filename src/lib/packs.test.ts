import { describe, expect, it } from "vitest";
import { describeCounts, packFileName } from "./packs";

describe("packFileName", () => {
  it("uses the project name with the pack extension", () => {
    expect(packFileName("Curse of Strahd")).toBe("Curse of Strahd.ttrpgpack");
  });

  it("replaces characters file systems reject and tidies spaces", () => {
    expect(packFileName('Dragons: "Rise" / Fall?')).toBe("Dragons Rise Fall.ttrpgpack");
    expect(packFileName("  a\\b|c*d  ")).toBe("a b c d.ttrpgpack");
    expect(packFileName("tab\there\nnewline")).toBe("tab here newline.ttrpgpack");
  });

  it("drops trailing dots and spaces (Windows rejects them)", () => {
    expect(packFileName("Project...")).toBe("Project.ttrpgpack");
    expect(packFileName("Project . ")).toBe("Project.ttrpgpack");
  });

  it("falls back to a generic name when nothing usable is left", () => {
    expect(packFileName("")).toBe("project.ttrpgpack");
    expect(packFileName(' / : * ? " ')).toBe("project.ttrpgpack");
    expect(packFileName("...")).toBe("project.ttrpgpack");
  });

  it("keeps non-English names and limits very long ones", () => {
    expect(packFileName("Café Noir 🐉")).toBe("Café Noir 🐉.ttrpgpack");
    const long = packFileName("x".repeat(500));
    expect(long.length).toBeLessThanOrEqual(80 + ".ttrpgpack".length);
    expect(long.endsWith(".ttrpgpack")).toBe(true);
  });
});

describe("describeCounts", () => {
  it("lists what a pack holds", () => {
    expect(
      describeCounts({ folders: 3, items: 6, tags: 4, itemTags: 4, links: 3, documents: 4 }),
    ).toBe("6 items, 3 folders, 4 tags, 3 links and 4 documents with text");
  });

  it("uses singular forms for one", () => {
    expect(
      describeCounts({ folders: 1, items: 1, tags: 1, itemTags: 0, links: 1, documents: 1 }),
    ).toBe("1 item, 1 folder, 1 tag, 1 link and 1 document with text");
  });

  it("handles an empty pack", () => {
    expect(
      describeCounts({ folders: 0, items: 0, tags: 0, itemTags: 0, links: 0, documents: 0 }),
    ).toBe("0 items, 0 folders, 0 tags, 0 links and 0 documents with text");
  });
});
