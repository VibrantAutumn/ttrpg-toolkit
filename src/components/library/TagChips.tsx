import type { Tag } from "../../api/library";

/** A read-only row of tag chips. */
export function TagChips({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="chips">
      {tags.map((t) => (
        <span
          key={t.id}
          className="chip static"
          style={t.color ? { borderColor: t.color } : undefined}
        >
          {t.name}
        </span>
      ))}
    </span>
  );
}
