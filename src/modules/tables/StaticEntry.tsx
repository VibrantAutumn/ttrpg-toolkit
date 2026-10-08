import { describeSlots, entryToModel } from "../../lib/tables/editorModel";
import { chipAttributes } from "./slotIcons";

/** An entry's text as read-only text with slot chips (what a row shows when it isn't being edited). */
export function StaticEntry({ value }: { value: string }) {
  const model = entryToModel(value);
  if (!model.ok) return <span className="static-entry">{value}</span>;
  if (model.nodes.length === 0) return <span className="static-entry meta">(empty)</span>;
  const described = describeSlots(model.nodes);
  return (
    <span className="static-entry">
      {model.nodes.map((node, i) => {
        if (node.type === "text") return <span key={i}>{node.text}</span>;
        if (node.type === "break") return <br key={i} />;
        const { className, ...rest } = chipAttributes(described[i], node.source);
        return <span key={i} className={className} {...rest} />;
      })}
    </span>
  );
}

/** The problems with an entry's slots, one line each (empty if all is well). */
export function slotProblems(value: string): string[] {
  const model = entryToModel(value);
  if (!model.ok) return [];
  const described = describeSlots(model.nodes);
  const problems: string[] = [];
  model.nodes.forEach((node, i) => {
    const d = described[i];
    if (node.type === "slot" && d && !d.ok) problems.push(`[${node.source}]: ${d.message}`);
  });
  return problems;
}
