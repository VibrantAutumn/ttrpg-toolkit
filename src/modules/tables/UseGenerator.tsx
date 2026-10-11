import { useEffect, useState } from "react";
import { getGenerator } from "../../api/generators";
import { listItemsOfType, type Item } from "../../api/library";
import { emptyGenerator, parseGenerator, type GeneratorDef } from "../../lib/generators/generator";
import { useCurrentProject } from "../../state/CurrentProject";
import { useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { GeneratorPreview } from "./GeneratorPreview";

/** Pick one of the project's generators and run it right here. */
export function UseGenerator({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const { project } = useCurrentProject();
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;

  const [generators, setGenerators] = useState<Item[]>([]);
  const [chosen, setChosen] = useState<string>("");
  const [def, setDef] = useState<GeneratorDef | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setGenerators([]);
      return;
    }
    let active = true;
    listItemsOfType(projectId, "tables", "generator")
      .then((list) => active && setGenerators([...list].sort((a, b) => a.name.localeCompare(b.name))))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  // The first generator until one is picked, and never one that is gone.
  const selected = generators.find((g) => g.id === chosen) ?? generators[0] ?? null;
  const selectedId = selected?.id ?? null;

  useEffect(() => {
    if (!selectedId) {
      setDef(null);
      return;
    }
    let active = true;
    getGenerator(selectedId)
      .then((saved) => {
        if (!active) return;
        const read = parseGenerator(saved.definitionJson);
        setDef(read.ok ? read.def : emptyGenerator());
        setProblem(read.ok ? null : read.error);
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [selectedId, dataVersion]);

  if (!projectId) return <p className="empty">Choose a project to use its generators.</p>;
  if (generators.length === 0) {
    return (
      <p className="empty">
        No generators yet. Choose “New generator”, or{" "}
        <button type="button" className="link" onClick={onOpenLibrary}>
          add the starter ones in the Library
        </button>
        .
      </p>
    );
  }

  return (
    <div>
      <div className="row wrap">
        <select value={selectedId ?? ""} aria-label="Generator" onChange={(e) => setChosen(e.currentTarget.value)}>
          {generators.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {selected && (
          <button type="button" onClick={() => openItem(selected.id)}>
            Edit generator
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {problem && <p className="error">This generator's saved settings can't be read ({problem}). Open it to fix it.</p>}
      {selected && def && <GeneratorPreview key={selected.id} projectId={projectId} def={def} name={selected.name} heading={null} />}
    </div>
  );
}
