import { useState } from "react";
import { setGeneratorDefinition } from "../../api/generators";
import { createItem, deleteItem } from "../../api/library";
import { checkGenerator, GENERATOR_VERSION } from "../../lib/generators/generator";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";

/** A name and the one piece of text the generator rolls; makes the generator and opens it. */
export function NewGenerator() {
  const { project } = useCurrentProject();
  const { openItem } = useNavigation();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!project) return <p className="empty">Choose a project to make a generator.</p>;
  const projectId = project.id;
  const why = checkGenerator({ version: GENERATOR_VERSION, text });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (why) return;
    try {
      const item = await createItem(projectId, "tables", "generator", name.trim() || "New generator", null);
      try {
        await setGeneratorDefinition(item.id, { version: GENERATOR_VERSION, text: text.trim() });
      } catch (err) {
        await deleteItem(item.id).catch(() => undefined); // don't leave an empty generator behind
        throw err;
      }
      setName("");
      setText("");
      setError(null);
      bumpDataVersion();
      openItem(item.id);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <form className="generator" onSubmit={(e) => void create(e)}>
      <label className="field">
        <span>Name</span>
        <input value={name} placeholder="For example, Faction attack" onChange={(e) => setName(e.currentTarget.value)} />
      </label>
      <label className="field">
        <span>What it says</span>
        <textarea
          value={text}
          rows={3}
          placeholder="[Faction] sends [2d4] agents to attack the party."
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setText(e.currentTarget.value)}
        />
      </label>
      <p className="meta">
        Anything in [square brackets] is rolled: a table by name (<code>[Faction]</code>), dice (<code>[2d4]</code>), a card draw (<code>[draw 1 from Tarot]</code>) or a document (<code>[entity:NPC]</code>). You can add chips and change them on the generator's page.
      </p>
      {why && <p className="error">{why}</p>}
      <button type="submit" disabled={why !== null}>
        Create generator
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
