import { useEffect, useMemo, useRef, useState } from "react";
import { getGenerator, setGeneratorDefinition } from "../../api/generators";
import { getItem, type Item } from "../../api/library";
import { createAutosaver, type SaveStatus } from "../../lib/autosave";
import { checkGenerator, emptyGenerator, GENERATOR_LIMITS, GENERATOR_VERSION, parseGenerator } from "../../lib/generators/generator";
import { bumpDataVersion } from "../../state/dataVersion";
import { EntryText } from "./EntryText";
import { GeneratorPreview } from "./GeneratorPreview";

/** The page of a generator: one piece of text with slots, and a place to try it out. */
export function GeneratorView({ itemId }: { itemId: string }) {
  const [item, setItem] = useState<Item | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);

  const saver = useMemo(
    () =>
      createAutosaver({
        save: async (value) => {
          await setGeneratorDefinition(itemId, { version: GENERATOR_VERSION, text: value });
          bumpDataVersion();
        },
        delayMs: 600,
        onStatus: setStatus,
      }),
    [itemId],
  );
  const saverRef = useRef(saver);
  saverRef.current = saver;

  useEffect(() => {
    let active = true;
    Promise.all([getItem(itemId), getGenerator(itemId)])
      .then(([it, saved]) => {
        if (!active) return;
        setItem(it);
        const read = parseGenerator(saved.definitionJson);
        setText((read.ok ? read.def : emptyGenerator()).text);
        setProblem(read.ok ? null : read.error);
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
      void saverRef.current.flush();
    };
  }, [itemId]);

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void saverRef.current.flush();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!item || text === null) return <p className="empty">Loading...</p>;

  const def = { version: GENERATOR_VERSION, text };
  const why = checkGenerator(def);
  const change = (next: string) => {
    setText(next);
    setProblem(null);
    saver.change(next);
  };

  return (
    <div className="generator">
      <p className="meta">
        Write what the generator says. Anything in [square brackets] is rolled each time, like a table entry:{" "}
        <code>[Faction] sends [2d4] agents to attack the party.</code>{" "}
        {status === "saved" ? "Saved." : status === "error" ? "Couldn't save yet; will try again." : "Saving..."}
      </p>
      {problem && <p className="error">This generator's saved settings can't be read ({problem}), so it is showing an empty one. Changing anything replaces the old settings.</p>}
      <EntryText value={text} onChange={change} onFlush={() => void saver.flush()} ariaLabel="What the generator rolls" />
      {text.length > GENERATOR_LIMITS.text && <p className="error">That is longer than the {GENERATOR_LIMITS.text} characters a generator can hold.</p>}
      {why && <p className="error">{why}</p>}
      <GeneratorPreview projectId={item.projectId} def={def} name={item.name} />
    </div>
  );
}
