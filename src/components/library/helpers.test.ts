import { describe, expect, it } from "vitest";
import type { Folder, Tag, TagLink } from "../../api/library";
import { childFolders, folderOptions, folderPath, tagsByItem } from "./helpers";

function folder(id: string, parentId: string | null = null, name = id): Folder {
  return {
    id,
    projectId: "c",
    library: "w",
    parentId,
    name,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
}

function tag(id: string, name = id): Tag {
  return {
    id,
    projectId: "c",
    parentId: null,
    name,
    color: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
}

const tree = [
  folder("npcs"),
  folder("villains", "npcs"),
  folder("dragons", "villains"),
  folder("places"),
];

describe("folderPath", () => {
  it("returns the chain from the top level down", () => {
    expect(folderPath(tree, "dragons").map((f) => f.id)).toEqual([
      "npcs",
      "villains",
      "dragons",
    ]);
  });

  it("returns an empty path for the top level or an unknown folder", () => {
    expect(folderPath(tree, null)).toEqual([]);
    expect(folderPath(tree, "nope")).toEqual([]);
  });

  it("does not loop forever on bad data", () => {
    const loop = [folder("a", "b"), folder("b", "a")];
    expect(folderPath(loop, "a").length).toBeLessThanOrEqual(2);
  });
});

describe("childFolders", () => {
  it("lists only direct children, alphabetically ignoring case", () => {
    const folders = [folder("1", null, "beta"), folder("2", null, "Alpha"), folder("3", "1", "inner")];
    expect(childFolders(folders, null).map((f) => f.name)).toEqual(["Alpha", "beta"]);
    expect(childFolders(folders, "1").map((f) => f.name)).toEqual(["inner"]);
  });
});

describe("folderOptions", () => {
  it("lists every folder, indenting nested ones", () => {
    const options = folderOptions(tree);
    expect(options.map((o) => o.id)).toEqual(["npcs", "villains", "dragons", "places"]);
    expect(options[0].label).toBe("npcs");
    expect(options[2].label).toBe("    dragons");
  });

  it("leaves out an excluded folder and everything below it", () => {
    expect(folderOptions(tree, "villains").map((o) => o.id)).toEqual(["npcs", "places"]);
  });
});

describe("tagsByItem", () => {
  it("groups tags under their item, keeping order", () => {
    const links: TagLink[] = [
      { itemId: "i1", tag: tag("a") },
      { itemId: "i2", tag: tag("b") },
      { itemId: "i1", tag: tag("c") },
    ];
    const grouped = tagsByItem(links);
    expect(grouped.get("i1")?.map((t) => t.id)).toEqual(["a", "c"]);
    expect(grouped.get("i2")?.map((t) => t.id)).toEqual(["b"]);
    expect(grouped.get("none")).toBeUndefined();
  });
});
