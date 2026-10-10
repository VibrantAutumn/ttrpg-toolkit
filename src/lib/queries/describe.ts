import { isGroup, isRuleComplete, type Comparison, type Group, type Node, type Query, type Rule } from "./query";

/** How to put names to the ids a query holds. Anything it can't find is shown as “(missing)”. */
export interface QueryNames {
  tag(id: string): string | undefined;
  folder(id: string): string | undefined;
  field(id: string): string | undefined;
  item(id: string): string | undefined;
  /** The label of one choice of a dropdown field. */
  choice(fieldId: string, optionId: string): string | undefined;
  /** A readable name for an item type id ("document" -> "Document"). */
  itemType(id: string): string;
  library(id: string): string;
}

const MISSING = "(missing)";
const quote = (t: string) => `“${t.trim()}”`;
const orList = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`);

const CMP_WORDS: Record<Comparison, [string, string]> = {
  "=": ["is", "isn't"],
  "<": ["is less than", "isn't less than"],
  "<=": ["is at most", "isn't at most"],
  ">": ["is more than", "isn't more than"],
  ">=": ["is at least", "isn't at least"],
};

function body(rule: Rule, names: QueryNames): string {
  const not = rule.not;
  switch (rule.kind) {
    case "itemType":
      return `${not ? "isn't" : "is"} ${orList(rule.types.map((t) => `a ${names.itemType(t).toLowerCase()}`))}`;
    case "library":
      return `${not ? "isn't" : "is"} in ${orList(rule.libraries.map((l) => names.library(l)))}`;
    case "folder": {
      const folder = names.folder(rule.folderId) ?? MISSING;
      return `${not ? "isn't" : "is"} in the folder ${folder}${rule.subfolders ? " or its folders" : ""}`;
    }
    case "tag": {
      const tag = names.tag(rule.tagId) ?? MISSING;
      return `${not ? "isn't" : "is"} tagged ${tag}${rule.subtags ? "" : " itself"}`;
    }
    case "name":
      return `name ${not ? "doesn't contain" : "contains"} ${quote(rule.text)}`;
    case "text":
      return `${not ? "doesn't mention" : "mentions"} ${quote(rule.text)}`;
    case "linksTo":
      return `${not ? "doesn't link" : "links"} to ${names.item(rule.itemId) ?? MISSING}`;
    case "linkedFrom":
      return `${not ? "isn't" : "is"} linked from ${names.item(rule.itemId) ?? MISSING}`;
    case "changed":
      return `${not ? "wasn't" : "was"} changed in the last ${rule.days === 1 ? "day" : `${rule.days} days`}`;
    case "field": {
      const field = names.field(rule.fieldId) ?? MISSING;
      const t = rule.test;
      switch (t.check) {
        case "contains":
          return `${field} ${not ? "doesn't contain" : "contains"} ${quote(t.text)}`;
        case "equals":
          return `${field} ${not ? "isn't" : "is"} ${quote(t.text)}`;
        case "number":
          return `${field} ${CMP_WORDS[t.cmp][not ? 1 : 0]} ${t.value}`;
        case "between":
          return `${field} ${not ? "isn't" : "is"} between ${t.min} and ${t.max}`;
        case "choice":
          return `${field} ${not ? "isn't" : "is"} ${orList(t.optionIds.map((o) => names.choice(rule.fieldId, o) ?? MISSING))}`;
        case "links":
          return `${field} ${not ? "doesn't link" : "links"} to ${names.item(t.itemId) ?? MISSING}`;
        case "empty":
          return `${field} ${not ? "has a value" : "is empty"}`;
      }
    }
  }
}

const INCOMPLETE: Record<Rule["kind"], string> = {
  itemType: "(choose a type)",
  library: "(choose a tool)",
  folder: "(choose a folder)",
  tag: "(choose a tag)",
  name: "(type some text)",
  text: "(type some text)",
  field: "(finish this field rule)",
  linksTo: "(choose an item)",
  linkedFrom: "(choose an item)",
  changed: "(choose how many days)",
};

/** One rule as a short phrase, such as “is tagged NPC” or “Status is Alive”. */
export function describeRule(rule: Rule, names: QueryNames): string {
  return isRuleComplete(rule) ? body(rule, names) : INCOMPLETE[rule.kind];
}

function hasContent(node: Node): boolean {
  return isGroup(node) ? node.rules.some(hasContent) : isRuleComplete(node);
}

function groupText(group: Group, names: QueryNames, nested: boolean): string {
  const parts = group.rules
    .filter(hasContent)
    .map((node) => (isGroup(node) ? groupText(node, names, true) : describeRule(node, names)));
  if (parts.length === 0) return "";
  const joined = parts.join(group.op === "all" ? " and " : " or ");
  if (group.not) return `not (${joined})`;
  return nested && parts.length > 1 ? `(${joined})` : joined;
}

/** A whole query in plain words, or “Everything” when it has no rules yet. Incomplete rules are left out, as they are when running. */
export function describeQuery(query: Query, names: QueryNames): string {
  const text = groupText(query.where, names, false);
  return text === "" ? "Everything" : text.charAt(0).toUpperCase() + text.slice(1);
}
