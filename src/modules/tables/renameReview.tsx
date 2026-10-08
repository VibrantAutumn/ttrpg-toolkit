import { findEntriesMentioning, setTableEntryTexts, type EntryRef } from "../../api/tables";
import { planRename } from "../../lib/tables/rename";
import type { RenameReviewer } from "../../registry/types";

const SNIPPET = 90;
const MOST_SHOWN = 12;

const snippet = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET ? `${flat.slice(0, SNIPPET)}…` : flat;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Slots in other tables (and this one) that name the table being renamed. Offered
 * before the rename, so the person sees exactly which entries would change and
 * how, and can rename without touching them.
 */
export const reviewTableRename: RenameReviewer = async (item, newName) => {
  const found = await findEntriesMentioning(item.campaignId, item.name);
  const plan = planRename(
    found.map((f) => ({ entryId: f.entryId, text: f.text })),
    item.name,
    newName.trim(),
  );
  if (plan.updates.length === 0 && plan.manual.length === 0) return null;

  const before = new Map<string, EntryRef>(found.map((f) => [f.entryId, f]));
  const after = new Map(plan.updates.map((u) => [u.entryId, u.text]));
  const shown = plan.updates.slice(0, MOST_SHOWN);
  const tables = new Set(plan.updates.map((u) => before.get(u.entryId)?.tableId));

  const preview = (
    <>
      {plan.updates.length > 0 ? (
        <p>
          {plural(plan.slots, "slot")} in {plural(plan.entries, "entry", "entries")} (in {plural(tables.size, "table")}) use
          this name. Renaming and updating changes them, so they keep finding this table.
        </p>
      ) : (
        <p>Some slots use this name, but none of them can be updated automatically.</p>
      )}
      {shown.length > 0 && (
        <ul className="rename-changes">
          {shown.map((u) => {
            const old = before.get(u.entryId);
            return (
              <li key={u.entryId}>
                <strong>{old?.tableName}</strong>
                <br />
                <span className="meta">{snippet(old?.text ?? "")}</span>
                <br />→ <span className="roll-text">{snippet(after.get(u.entryId) ?? "")}</span>
              </li>
            );
          })}
        </ul>
      )}
      {plan.updates.length > shown.length && (
        <p className="meta">…and {plural(plan.updates.length - shown.length, "more entry", "more entries")}.</p>
      )}
      {plan.manual.length > 0 && (
        <>
          <p className="error">
            {plural(plan.manual.length, "entry", "entries")} can't be updated automatically, because “
            {newName.trim()}” can't be written as a table name there. They will stop finding this table:
          </p>
          <ul className="rename-changes">
            {plan.manual.slice(0, MOST_SHOWN).map((m) => (
              <li key={m.entryId}>
                <strong>{before.get(m.entryId)?.tableName}</strong>
                <br />
                <span className="meta">{snippet(m.text)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="meta">
        Card draws and other slots that don't name this table are left alone. “Rename only” leaves every entry as it
        is, and slots using the old name will show a warning when rolled.
      </p>
    </>
  );

  return {
    preview,
    summary: `Updated ${plural(plan.slots, "slot")} in ${plural(plan.entries, "entry", "entries")}.`,
    canUpdate: plan.updates.length > 0,
    update: () => setTableEntryTexts(plan.updates),
    undo: () =>
      setTableEntryTexts(
        plan.updates.flatMap((u) => {
          const old = before.get(u.entryId);
          return old ? [{ entryId: u.entryId, text: old.text }] : [];
        }),
      ),
  };
};
