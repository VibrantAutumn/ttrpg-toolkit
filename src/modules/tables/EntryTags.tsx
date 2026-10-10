import { useState } from "react";
import { createTag } from "../../api/library";
import { addTableEntryTag, removeTableEntryTag } from "../../api/tables";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion } from "../../state/dataVersion";
import { useSlotChoices } from "./SlotChoices";

/**
 * The project tags on one entry, behind a "Tags (n)" button so the list stays
 * tidy. They are the same tags used everywhere else; rolling doesn't use them
 * yet (filtering by tag arrives with the query engine in a later phase).
 */
export function EntryTags({
  entryId,
  tagIds,
  onChanged,
}: {
  entryId: string;
  tagIds: readonly string[];
  /** Called with the entry's new list of tags after a change. */
  onChanged: (entryId: string, tagIds: string[]) => void;
}) {
  const { project } = useCurrentProject();
  const { tags } = useSlotChoices();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const on = new Set(tagIds);
  const mine = tags.filter((t) => on.has(t.id));

  async function toggle(tagId: string) {
    try {
      if (on.has(tagId)) {
        await removeTableEntryTag(entryId, tagId);
        onChanged(entryId, tagIds.filter((id) => id !== tagId));
      } else {
        await addTableEntryTag(entryId, tagId);
        onChanged(entryId, [...tagIds, tagId]);
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function addNew() {
    if (!project || name.trim() === "") return;
    try {
      const tag = await createTag(project.id, null, name, null);
      await addTableEntryTag(entryId, tag.id);
      onChanged(entryId, [...tagIds, tag.id]);
      setName("");
      setError(null);
      bumpDataVersion(); // other screens and this page's tag list pick up the new tag
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="entry-tags">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Tags ({tagIds.length}) {open ? "▾" : "▸"}
      </button>
      {!open && mine.length > 0 && (
        <span className="chips">
          {mine.map((t) => (
            <span key={t.id} className="chip static" style={t.color ? { borderColor: t.color } : undefined}>
              {t.name}
            </span>
          ))}
        </span>
      )}
      {open && (
        <div className="tag-editor">
          {tags.length === 0 && <p className="empty">No tags yet. Create the first one below.</p>}
          <div className="chips">
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                className={on.has(t.id) ? "chip on" : "chip"}
                aria-pressed={on.has(t.id)}
                style={t.color ? { borderColor: t.color } : undefined}
                onClick={() => void toggle(t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void addNew();
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="New tag..."
              aria-label="New tag name"
            />
            <button type="submit" disabled={name.trim() === ""}>
              Add tag
            </button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
