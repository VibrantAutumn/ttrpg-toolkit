import { docToMarkdown } from "../documents/markdown";
import type { DocNode, DocRoot } from "../documents/types";
import type { FieldDefinition } from "../fields/definition";
import { coerceValue, isEmpty, type FieldValue } from "../fields/value";
import type { ResultPart } from "../tables/roll";
import type { GeneratorDef } from "./generator";
import { rowValue, type GeneratedRow, type GeneratorRun } from "./run";

/**
 * Turns a generator run into what a new document gets: its name, values for fields, and a section of
 * text. The text uses mentions for documents the rolls picked, so they stay linked. Anything that can't
 * be applied (a number that isn't one, a dropdown choice that doesn't exist) is left out and explained
 * in `warnings` so the preview can say so before anything is made. Pure logic.
 */

export interface FieldAssignment {
  fieldId: string;
  value: FieldValue;
}

export interface GeneratedDocument {
  name: string;
  fields: FieldAssignment[];
  /** Markdown to add to the end of the document's text ("" when no row fills the text). */
  section: string;
  /** Ids of the documents mentioned in the section. */
  mentions: string[];
  warnings: string[];
}

const SECTION_TITLE = "Generated";

/** The documents picked by a row's entity slots, in order. */
export function pickedItems(row: GeneratedRow): { id: string; name: string }[] {
  if (!row.roll || row.override !== undefined) return [];
  return row.roll.parts.flatMap((p) => (p.kind === "slot" && p.outcome.type === "entity" ? p.outcome.picks : []));
}

function mentionNode(id: string, label: string): DocNode {
  return { type: "mention", attrs: { id, label } };
}

/** The row's value as inline nodes: picked documents become mentions, everything else is text. */
function valueNodes(row: GeneratedRow): DocNode[] {
  if (row.override !== undefined || !row.roll) return row.override === undefined || row.override === "" ? [] : [{ type: "text", text: row.override }];
  const nodes: DocNode[] = [];
  const push = (text: string) => text !== "" && nodes.push({ type: "text", text });
  row.roll.parts.forEach((part: ResultPart) => {
    if (part.kind === "slot" && part.outcome.type === "entity" && part.outcome.picks.length > 0) {
      part.outcome.picks.forEach((pick, i) => {
        if (i > 0) push(", ");
        nodes.push(mentionNode(pick.id, pick.name));
      });
    } else {
      push(part.text);
    }
  });
  return nodes;
}

/** A guess at a number in text: the first number in it. */
function numberIn(text: string): number | null {
  const m = /-?\d+(?:[.,]\d+)?/.exec(text);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** What a row's value would be for a field of this kind, before checking it fits. */
function candidateFor(def: FieldDefinition, row: GeneratedRow): unknown {
  const text = rowValue(row).trim();
  switch (def.kind) {
    case "text":
    case "formula":
      return text;
    case "number":
      return numberIn(text);
    case "dropdown":
      return def.config.options.find((o) => o.label.trim().toLowerCase() === text.toLowerCase())?.id ?? null;
    case "list":
      return text === "" ? [] : [{ title: text, text: "" }];
    case "link": {
      const ids = pickedItems(row).map((p) => p.id);
      return def.config.many ? ids : ids.slice(0, 1);
    }
    case "bar":
      return undefined;
  }
}

/** Why a row's value gave nothing for a field of this kind. */
function whyEmpty(def: FieldDefinition, value: string): string {
  switch (def.kind) {
    case "number":
      return `“${value}” has no number in it.`;
    case "dropdown":
      return `“${value}” isn't one of its choices.`;
    case "link":
      return "no document was picked, so there is nothing to link.";
    default:
      return `“${value}” can't be used here.`;
  }
}

export function buildDocument(
  def: GeneratorDef,
  run: GeneratorRun,
  fields: readonly FieldDefinition[],
  fallbackName: string,
): GeneratedDocument {
  const warnings: string[] = [];
  const byRow = new Map(run.rows.map((r) => [r.rowId, r]));
  let name = "";
  const assignments: FieldAssignment[] = [];
  const lines: DocNode[] = [];
  const mentions = new Set<string>();

  for (const row of def.rows) {
    const generated = byRow.get(row.id);
    if (!generated) continue;
    const label = row.label || "Row";
    const value = rowValue(generated).trim();
    if (value === "") continue;
    switch (row.target.kind) {
      case "name":
        if (name === "") name = value;
        else warnings.push(`“${label}” was not used: a document has only one name.`);
        break;
      case "field": {
        const fieldId = row.target.fieldId;
        const field = fields.find((f) => f.id === fieldId);
        if (!field) {
          warnings.push(`“${label}” fills a field that no longer exists, so it was left out.`);
          break;
        }
        const candidate = candidateFor(field, generated);
        if (candidate === undefined) {
          warnings.push(`“${label}”: ${field.name} is a bar, which can't be generated.`);
          break;
        }
        const checked = coerceValue(field, candidate);
        if (!checked.ok) warnings.push(`“${label}” → ${field.name}: ${checked.error}`);
        else if (isEmpty(field, checked.value)) warnings.push(`“${label}” → ${field.name}: ${whyEmpty(field, value)}`);
        else if (assignments.some((a) => a.fieldId === fieldId)) warnings.push(`“${label}” was not used: ${field.name} is already filled by another row.`);
        else assignments.push({ fieldId, value: checked.value });
        break;
      }
      case "text": {
        const content = valueNodes(generated);
        lines.push({ type: "paragraph", content: [{ type: "text", text: `${label}: `, marks: [{ type: "bold" }] }, ...content] });
        for (const n of content) if (n.type === "mention") mentions.add(String(n.attrs?.id));
        break;
      }
    }
  }

  let section = "";
  if (lines.length > 0) {
    const doc: DocRoot = {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: SECTION_TITLE }] }, ...lines],
    };
    section = docToMarkdown(doc);
  }
  return { name: name || fallbackName, fields: assignments, section, mentions: [...mentions], warnings };
}

/** The text a new document ends with: its own text, then the generated section. */
export function appendSection(body: string, section: string): string {
  if (section === "") return body;
  const trimmed = body.replace(/\s+$/, "");
  return trimmed === "" ? section : `${trimmed}\n\n${section}`;
}
