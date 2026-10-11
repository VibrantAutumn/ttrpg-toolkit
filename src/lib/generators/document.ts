import { docToMarkdown } from "../documents/markdown";
import type { DocNode, DocRoot } from "../documents/types";
import { leafParts } from "../tables/roll";
import type { GeneratorRun } from "./run";

/**
 * Turns a generator's output into a page the person chose to save: the text as paragraphs, with a
 * mention wherever a rolled slot picked a document, so the page links to it. Pure logic.
 */

export interface SavedOutput {
  name: string;
  markdown: string;
  /** Ids of the documents mentioned. */
  mentions: string[];
}

const NAME_LIMIT = 60;

export function outputPage(run: GeneratorRun, generatorName: string): SavedOutput {
  const mentions = new Set<string>();
  const paragraphs: DocNode[][] = [[]];
  const pushText = (text: string) => {
    text.split("\n").forEach((line, i) => {
      if (i > 0) paragraphs.push([]);
      if (line !== "") paragraphs[paragraphs.length - 1].push({ type: "text", text: line });
    });
  };
  for (const part of leafParts(run.roll.parts)) {
    if (part.kind === "slot" && part.outcome.type === "entity" && part.outcome.picks.length > 0) {
      part.outcome.picks.forEach((pick, i) => {
        if (i > 0) pushText(", ");
        paragraphs[paragraphs.length - 1].push({ type: "mention", attrs: { id: pick.id, label: pick.name } });
        mentions.add(pick.id);
      });
    } else {
      pushText(part.text);
    }
  }
  const doc: DocRoot = {
    type: "doc",
    content: paragraphs.filter((p) => p.length > 0).map((content) => ({ type: "paragraph", content })),
  };
  const oneLine = run.roll.text.replace(/\s+/g, " ").trim();
  const name = oneLine === "" ? generatorName : oneLine.length > NAME_LIMIT ? `${oneLine.slice(0, NAME_LIMIT - 1).trimEnd()}…` : oneLine;
  return { name, markdown: docToMarkdown(doc), mentions: [...mentions] };
}
