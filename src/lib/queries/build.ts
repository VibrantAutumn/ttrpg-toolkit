import { QUERY_LIMITS, isGroup, type FieldCheck, type FieldTest, type Group, type Node, type Query, type Rule, type RuleKind } from "./query";

/**
 * Editing a query without changing it in place: every function returns a new query. A node is
 * found by its path, the list of positions to follow from the first group (`[]` is the first
 * group itself, `[2, 0]` is the first thing inside the third thing).
 */

export type Path = number[];

export function defaultTest(check: FieldCheck): FieldTest {
  switch (check) {
    case "contains":
    case "equals":
      return { check, text: "" };
    case "number":
      return { check, cmp: "=", value: 0 };
    case "between":
      return { check, min: 0, max: 10 };
    case "choice":
      return { check, optionIds: [] };
    case "links":
      return { check, itemId: "" };
    case "empty":
      return { check };
  }
}

/** A new rule of this kind with nothing chosen yet. */
export function defaultRule(kind: RuleKind): Rule {
  const not = false;
  switch (kind) {
    case "itemType":
      return { kind, types: [], not };
    case "library":
      return { kind, libraries: [], not };
    case "folder":
      return { kind, folderId: "", subfolders: true, not };
    case "tag":
      return { kind, tagId: "", subtags: true, not };
    case "name":
    case "text":
      return { kind, text: "", not };
    case "field":
      return { kind, fieldId: "", test: { check: "empty" }, not };
    case "linksTo":
    case "linkedFrom":
      return { kind, itemId: "", not };
    case "changed":
      return { kind, days: 7, not };
  }
}

export function newGroup(op: "all" | "any" = "all"): Group {
  return { op, not: false, rules: [] };
}

export function getNode(query: Query, path: Path): Node | null {
  let node: Node = query.where;
  for (const index of path) {
    if (!isGroup(node)) return null;
    const next: Node | undefined = node.rules[index];
    if (!next) return null;
    node = next;
  }
  return node;
}

/** Replaces the node at `path` with what `change` returns for it (or leaves the query alone if there is no such node). */
function modify(query: Query, path: Path, change: (node: Node) => Node): Query {
  const walk = (node: Node, rest: Path): Node => {
    if (rest.length === 0) return change(node);
    if (!isGroup(node)) return node;
    const [index, ...tail] = rest;
    if (index < 0 || index >= node.rules.length) return node;
    return { ...node, rules: node.rules.map((child, i) => (i === index ? walk(child, tail) : child)) };
  };
  const where = walk(query.where, path);
  return isGroup(where) ? { ...query, where } : query;
}

export function replaceNode(query: Query, path: Path, node: Node): Query {
  return path.length === 0 && !isGroup(node) ? query : modify(query, path, () => node);
}

/** Changes a rule in place (`not`, its text, its tag...). Does nothing if the node is a group. */
export function updateRule(query: Query, path: Path, change: Partial<Rule> | ((rule: Rule) => Rule)): Query {
  return modify(query, path, (node) => {
    if (isGroup(node)) return node;
    return typeof change === "function" ? change(node) : ({ ...node, ...change } as Rule);
  });
}

export function updateGroup(query: Query, path: Path, change: Partial<Pick<Group, "op" | "not">>): Query {
  return modify(query, path, (node) => (isGroup(node) ? { ...node, ...change } : node));
}

export function countNodes(group: Group): number {
  return group.rules.reduce((n, node) => n + 1 + (isGroup(node) ? countNodes(node) : 0), 0);
}

/** How many groups deep a path goes, counting the first group. */
function groupDepth(query: Query, path: Path): number {
  let depth = 1;
  let node: Node = query.where;
  for (const index of path) {
    if (!isGroup(node)) break;
    const next: Node | undefined = node.rules[index];
    if (!next) break;
    node = next;
    if (isGroup(node)) depth++;
  }
  return depth;
}

/** Whether another rule or group can be added inside the group at `path` without breaking a limit. */
export function canAdd(query: Query, groupPath: Path, node: Node): boolean {
  const target = getNode(query, groupPath);
  if (!target || !isGroup(target)) return false;
  if (countNodes(query.where) + 1 + (isGroup(node) ? countNodes(node) : 0) > QUERY_LIMITS.nodes) return false;
  if (isGroup(node) && groupDepth(query, groupPath) + 1 > QUERY_LIMITS.depth) return false;
  return true;
}

export function addNode(query: Query, groupPath: Path, node: Node): Query {
  if (!canAdd(query, groupPath, node)) return query;
  return modify(query, groupPath, (target) => (isGroup(target) ? { ...target, rules: [...target.rules, node] } : target));
}

export function removeNode(query: Query, path: Path): Query {
  if (path.length === 0) return query;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  return modify(query, parentPath, (parent) =>
    isGroup(parent) ? { ...parent, rules: parent.rules.filter((_, i) => i !== index) } : parent,
  );
}

/** Moves a node up (-1) or down (+1) among its neighbours. */
export function moveNode(query: Query, path: Path, delta: -1 | 1): Query {
  if (path.length === 0) return query;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  return modify(query, parentPath, (parent) => {
    if (!isGroup(parent)) return parent;
    const to = index + delta;
    if (to < 0 || to >= parent.rules.length) return parent;
    const rules = parent.rules.slice();
    [rules[index], rules[to]] = [rules[to], rules[index]];
    return { ...parent, rules };
  });
}

/** Whether the query fits the simple builder: one list of rules, no nested groups, not turned around. */
export function isSimple(query: Query): boolean {
  return !query.where.not && query.where.rules.every((node) => !isGroup(node));
}
