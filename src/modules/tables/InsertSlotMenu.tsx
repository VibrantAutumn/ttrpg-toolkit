import { useId, useState } from "react";
import { buildSlotSource, checkSlotChoice, type SlotChoice } from "../../lib/tables/slotSource";
import { SLOT_ICONS } from "./slotIcons";
import { useSlotChoices } from "./SlotChoices";

type Kind = "dice" | "table" | "draw" | "ref";

/**
 * The "Insert slot" menu: pick a kind of slot, fill in a few boxes, and it hands
 * back the slot's text (in the explicit form, like `table:Rumors`) to put in the
 * entry. `labels` are the names earlier slots in this entry have given their results.
 */
export function InsertSlotMenu({
  labels,
  onInsert,
  onClose,
}: {
  labels: readonly string[];
  onInsert: (source: string) => void;
  onClose: () => void;
}) {
  const { tables, collections } = useSlotChoices();
  const listId = useId();
  const [kind, setKind] = useState<Kind | null>(null);
  const [notation, setNotation] = useState("");
  const [name, setName] = useState("");
  const [countText, setCountText] = useState("1");
  const [unique, setUnique] = useState(false);
  const [label, setLabel] = useState(labels[0] ?? "");
  const [resultName, setResultName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function submit() {
    if (!kind) return;
    const count = countText.trim() === "" ? NaN : Number(countText);
    const named = resultName.trim() === "" ? {} : { label: resultName.trim() };
    const choice: SlotChoice =
      kind === "dice"
        ? { type: "dice", notation, ...named }
        : kind === "table"
          ? { type: "table", name, count, unique: unique && count > 1, ...named }
          : kind === "draw"
            ? { type: "draw", source: name, count, ...named }
            : { type: "ref", label };
    const why = checkSlotChoice(choice);
    if (why) {
      setProblem(why);
      return;
    }
    onInsert(buildSlotSource(choice));
  }

  if (!kind) {
    return (
      <div className="insert-slot" role="group" aria-label="Insert a slot">
        <div className="row wrap">
          <button onClick={() => setKind("dice")}>{SLOT_ICONS.dice} Dice…</button>
          <button onClick={() => setKind("table")}>{SLOT_ICONS.table} Table…</button>
          <button onClick={() => setKind("draw")}>{SLOT_ICONS.draw} Card draw…</button>
          <button onClick={() => setKind("ref")} disabled={labels.length === 0} title={labels.length === 0 ? "Name a result first (“Name this result” on another slot)" : undefined}>
            {SLOT_ICONS.ref} Reuse a result…
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    );
  }

  const options = kind === "draw" ? collections.map((c) => c.name) : tables.map((t) => t.name);

  return (
    <form
      className="insert-slot"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {kind === "dice" && (
        <label className="field">
          <span>Dice formula</span>
          <input
            value={notation}
            onChange={(e) => setNotation(e.currentTarget.value)}
            placeholder="2d4"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </label>
      )}
      {(kind === "table" || kind === "draw") && (
        <>
          <label className="field">
            <span>{kind === "table" ? "Table" : "Deck, set or pool"}</span>
            <input
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              list={listId}
              placeholder={kind === "table" ? "Choose or type a table name" : "Choose or type a name"}
              autoFocus
            />
            <datalist id={listId}>
              {options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>
          <div className="row wrap">
            <label>
              {kind === "table" ? "Roll it" : "Draw"}{" "}
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={countText}
                onChange={(e) => setCountText(e.currentTarget.value)}
                className="narrow"
              />{" "}
              {kind === "table" ? "time(s)" : "card(s)"}
            </label>
            {kind === "table" && Number(countText) > 1 && (
              <label>
                <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.currentTarget.checked)} /> No repeats
              </label>
            )}
          </div>
        </>
      )}
      {kind === "ref" && (
        <label className="field">
          <span>Reuse the result named</span>
          <select value={label} onChange={(e) => setLabel(e.currentTarget.value)}>
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind !== "ref" && (
        <details>
          <summary>Name this result (optional)</summary>
          <label className="field">
            <span>Name, to reuse it later in this entry</span>
            <input
              value={resultName}
              onChange={(e) => setResultName(e.currentTarget.value)}
              placeholder="A"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
        </details>
      )}
      {problem && <p className="error" role="alert">{problem}</p>}
      <div className="row wrap">
        <button type="submit">Insert</button>
        <button type="button" onClick={() => setKind(null)}>
          Back
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
