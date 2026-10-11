import { useState, type FocusEvent } from "react";
import { entryToModel } from "../../lib/tables/editorModel";
import { ChipEditor } from "./ChipEditor";
import { StaticEntry, slotProblems } from "./StaticEntry";
import { useLinkNames } from "./useLinkNames";

/**
 * An entry's text. At rest it shows the text with slot chips; tap it to edit with
 * chips inside the text, or switch to "Edit as text" to see and type the raw
 * [slots]. Text with a mistake the chips can't show (like an unclosed [) opens as
 * plain text with the problem pointed out. Only the entry being edited runs the
 * rich editor, so a long table stays light.
 */
export function EntryText({
  value,
  onChange,
  onFlush,
  ariaLabel,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Save what has been typed now (called when editing ends). */
  onFlush: () => void;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [asText, setAsText] = useState(false);
  const namesVersion = useLinkNames(value);

  const model = entryToModel(value);
  const textMode = asText || !model.ok;

  function leaving(e: FocusEvent<HTMLDivElement>) {
    // Focus moving between the editor, its menu and its buttons doesn't end editing.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setEditing(false);
    onFlush();
  }

  const problems = slotProblems(value);

  return (
    <div className="entry-text" onBlur={leaving}>
      {textMode ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          aria-label={ariaLabel}
          rows={3}
          spellCheck
        />
      ) : editing ? (
        <ChipEditor value={value} onChange={onChange} ariaLabel={ariaLabel} namesVersion={namesVersion} />
      ) : (
        <div
          className="entry-static"
          role="button"
          tabIndex={0}
          aria-label={`${ariaLabel} (tap to edit)`}
          onClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditing(true);
            }
          }}
        >
          <StaticEntry value={value} />
        </div>
      )}
      {!model.ok && (
        <p className="error" role="alert">
          ⚠ Character {model.error.position + 1}: {model.error.message} Until it is fixed this entry is rolled as
          plain text.
        </p>
      )}
      {problems.length > 0 && (
        <ul className="meta">
          {problems.map((p) => (
            <li key={p}>⚠ {p}</li>
          ))}
        </ul>
      )}
      {model.ok && (
        <div className="row wrap mini-actions">
          <button type="button" onClick={() => setAsText((v) => !v)}>
            {asText ? "Edit with chips" : "Edit as text"}
          </button>
        </div>
      )}
    </div>
  );
}
