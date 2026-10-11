import { useState } from "react";
import { NewGenerator } from "./NewGenerator";
import { TableList } from "./TableList";
import { UseGenerator } from "./UseGenerator";

type Choice = "table" | "generator" | "new";

const CHOICES: { id: Choice; label: string; hint: string }[] = [
  { id: "table", label: "Roll a table", hint: "Pick an entry from one of your tables." },
  { id: "generator", label: "Use a generator", hint: "Roll a set of rows and make a document from them." },
  { id: "new", label: "New generator", hint: "Build your own set of rows." },
];

/** "What do you want to generate?": the three things this tool does, one tap each. */
export function GeneratorsHome({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const [choice, setChoice] = useState<Choice>("table");
  return (
    <div>
      <h2>What do you want to generate?</h2>
      <div className="row wrap" role="group" aria-label="What to generate">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={choice === c.id}
            className={choice === c.id ? "active" : undefined}
            title={c.hint}
            onClick={() => setChoice(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="meta">{CHOICES.find((c) => c.id === choice)?.hint}</p>
      {/* Each part stays mounted (just hidden) so a roll in progress isn't lost when you look at another. */}
      <div hidden={choice !== "table"}>
        <TableList onOpenLibrary={onOpenLibrary} />
      </div>
      <div hidden={choice !== "generator"}>
        <UseGenerator onOpenLibrary={onOpenLibrary} />
      </div>
      <div hidden={choice !== "new"}>
        <NewGenerator />
      </div>
    </div>
  );
}
