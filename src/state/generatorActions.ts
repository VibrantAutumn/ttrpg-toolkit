import { listFieldDefinitions, saveFieldValue } from "../api/fields";
import { createFromTemplate, createItem, getDocumentBody, getItem, setDocumentBody, type Item } from "../api/library";
import { recordTableRecent } from "../api/tables";
import { markdownToDoc } from "../lib/documents/markdown";
import { mentionIds } from "../lib/documents/mentions";
import { newSeed } from "../lib/dice/rng";
import { appendSection, buildDocument, type GeneratedDocument } from "../lib/generators/document";
import type { GeneratorDef } from "../lib/generators/generator";
import { generate, pickedEntries, rerollRows, type GeneratorRun } from "../lib/generators/run";
import { bumpDataVersion } from "./dataVersion";
import { loadTableWorld } from "./tableActions";

/** Rolls every row, reading the tables and documents fresh, and remembers the entries picked ("avoid recent"). */
export async function runGenerator(projectId: string, def: GeneratorDef): Promise<GeneratorRun> {
  const { world } = await loadTableWorld(projectId);
  const run = generate(def, world, newSeed());
  await recordTableRecent(pickedEntries(run));
  return run;
}

/** Rolls the rows not in `keep` again. */
export async function rerollGenerator(projectId: string, def: GeneratorDef, run: GeneratorRun, keep: ReadonlySet<string>): Promise<GeneratorRun> {
  const { world } = await loadTableWorld(projectId);
  const next = rerollRows(def, run, keep, world, newSeed());
  await recordTableRecent(pickedEntries(next));
  return next;
}

/** What creating the document would do, for the preview (names the template, checks every field). */
export async function previewDocument(projectId: string, def: GeneratorDef, run: GeneratorRun, generatorName: string): Promise<GeneratedDocument> {
  const [fields, templateName] = await Promise.all([listFieldDefinitions(projectId), nameOf(def.templateId)]);
  return buildDocument(def, run, fields, templateName ? `New ${templateName}` : `New ${generatorName}`);
}

async function nameOf(id: string | null): Promise<string | null> {
  if (!id) return null;
  try {
    const item = await getItem(id);
    return item.deletedAt === null ? item.name : null;
  } catch {
    return null;
  }
}

export type CreateResult = { ok: true; item: Item; warnings: string[] } | { ok: false; message: string };

/**
 * Makes the document from the run: from the template (so it gets its sets, tags, tabs and text) or as a
 * plain document, then its name, the field values and the generated section of text. If a step fails
 * after the document exists, the message says so (the document is kept, never half-hidden).
 */
export async function createFromRun(projectId: string, def: GeneratorDef, run: GeneratorRun, generatorName: string): Promise<CreateResult> {
  let item: Item | null = null;
  try {
    const [fields, templateName] = await Promise.all([listFieldDefinitions(projectId), nameOf(def.templateId)]);
    if (def.templateId && !templateName) {
      return { ok: false, message: "This generator's template is gone or in the trash. Choose another template, or none." };
    }
    const doc = buildDocument(def, run, fields, templateName ? `New ${templateName}` : `New ${generatorName}`);
    item = def.templateId
      ? await createFromTemplate(def.templateId, doc.name, null)
      : await createItem(projectId, "worldbuilding", "document", doc.name, null);
    for (const a of doc.fields) {
      const field = fields.find((f) => f.id === a.fieldId);
      if (field) await saveFieldValue(field, item.id, a.value, false);
    }
    if (doc.section !== "") {
      const body = appendSection(await getDocumentBody(item.id), doc.section);
      await setDocumentBody(item.id, body, mentionIds(markdownToDoc(body)));
    }
    bumpDataVersion();
    return { ok: true, item, warnings: doc.warnings };
  } catch (e) {
    bumpDataVersion();
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, message: item ? `The document “${item.name}” was made, but not everything could be filled in: ${reason}` : reason };
  }
}
