import { useState } from "react";
import {
  addTagToItem,
  createTag,
  removeTagFromItem,
  type Tag,
} from "../../api/library";

/** Toggle the campaign's tags on one item, or create a new tag and attach it. */
export function TagEditor({
  campaignId,
  itemId,
  itemTags,
  allTags,
  run,
}: {
  campaignId: string;
  itemId: string;
  itemTags: Tag[];
  allTags: Tag[];
  /** Runs a change, then reloads the library and shows any error. */
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const attached = new Set(itemTags.map((t) => t.id));

  return (
    <div className="tag-editor">
      {allTags.length === 0 && (
        <p className="empty">No tags yet. Create the first one below.</p>
      )}
      <div className="chips">
        {allTags.map((t) => {
          const on = attached.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              className={on ? "chip on" : "chip"}
              aria-pressed={on}
              style={t.color ? { borderColor: t.color } : undefined}
              onClick={() =>
                run(() =>
                  on ? removeTagFromItem(itemId, t.id) : addTagToItem(itemId, t.id),
                )
              }
            >
              {t.name}
            </button>
          );
        })}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const tag = await createTag(campaignId, null, name, null);
            await addTagToItem(itemId, tag.id);
            setName("");
          });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="New tag..."
          aria-label="New tag name"
        />
        <button type="submit">Add tag</button>
      </form>
    </div>
  );
}
