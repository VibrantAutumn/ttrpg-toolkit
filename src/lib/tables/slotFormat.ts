/**
 * Text formats for slots: `[table:Names | upper]`. A format changes how a slot's
 * result is written (case), never what is picked, so it can't change any roll's
 * randomness. Only slots that give words can have one (table, entity, link and
 * reference slots); dice and draws are left alone. Pure logic.
 */

export const SLOT_FORMATS = ["lower", "upper", "title", "sentence", "camel"] as const;
export type SlotFormat = (typeof SLOT_FORMATS)[number];

/** What each format is called in the interface. */
export const FORMAT_LABELS: Record<SlotFormat, string> = {
  lower: "lowercase",
  upper: "UPPERCASE",
  title: "Title Case",
  sentence: "Sentence case",
  camel: "camelCase",
};

/** Explicit slot types that give words (and so may carry a format). Shorthand slots are decided after reading. */
export const FORMATTABLE_KINDS: ReadonlySet<string> = new Set(["table", "entity", "link", "ref"]);

const TRAILING_FORMAT = /^([\s\S]*?)\s*\|\s*(lower|upper|title|sentence|camel)\s*$/i;

/** Splits a trailing ` | format` off what was written in the brackets. Unknown words after a `|` stay in the text. */
export function splitFormat(source: string): { base: string; format?: SlotFormat } {
  const m = TRAILING_FORMAT.exec(source);
  if (!m || m[1].trim() === "") return { base: source };
  return { base: m[1].trim(), format: m[2].toLowerCase() as SlotFormat };
}

/** The written form with its format replaced (or removed with `undefined`). Leaves dice, draws and unknown types alone. */
export function withFormat(source: string, format: SlotFormat | undefined): string {
  const kind = /^([a-z][a-z0-9_]*):/.exec(source)?.[1];
  if (kind !== undefined && !FORMATTABLE_KINDS.has(kind)) return source;
  const { base } = splitFormat(source.trim());
  return format === undefined ? base : `${base} | ${format}`;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

const upperFirst = (s: string) => (s === "" ? s : s.charAt(0).toUpperCase() + s.slice(1));

/** Writes text in a format. Everything but letters keeps its place, except for camelCase, which joins the words. */
export function applyFormat(text: string, format: SlotFormat | undefined): string {
  switch (format) {
    case undefined:
      return text;
    case "lower":
      return text.toLowerCase();
    case "upper":
      return text.toUpperCase();
    case "title":
      return text.replace(WORD, (w) => upperFirst(w.toLowerCase()));
    case "sentence": {
      const lower = text.toLowerCase();
      const at = lower.search(/[\p{L}\p{N}]/u);
      return at < 0 ? lower : lower.slice(0, at) + upperFirst(lower.slice(at));
    }
    case "camel": {
      const words = text.match(WORD) ?? [];
      return words.map((w, i) => (i === 0 ? w.toLowerCase() : upperFirst(w.toLowerCase()))).join("");
    }
  }
}
