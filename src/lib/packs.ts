import type { PackCounts } from "../api/packs";

export const PACK_EXTENSION = "ttrpgpack";

/**
 * A safe default file name for exporting a campaign, e.g. "Curse of Strahd.ttrpgpack".
 * Characters that Windows or Android file systems reject are replaced, and
 * trailing dots/spaces (also rejected on Windows) are removed.
 */
export function packFileName(campaignName: string): string {
  const cleaned = campaignName
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, "");
  return `${cleaned || "campaign"}.${PACK_EXTENSION}`;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** e.g. "6 items, 3 folders, 4 tags, 3 links and 4 documents with text". */
export function describeCounts(counts: PackCounts): string {
  const parts = [
    plural(counts.items, "item"),
    plural(counts.folders, "folder"),
    plural(counts.tags, "tag"),
    plural(counts.links, "link"),
    `${plural(counts.documents, "document")} with text`,
  ];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
