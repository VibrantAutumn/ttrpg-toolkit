import { useMemo } from "react";
import { ConfirmButton } from "../ConfirmButton";
import type { ResultKind } from "../../lib/results/rollLog";
import { rollLog, useRollLog } from "../../state/rollLog";
import { LogEntryView } from "./LogEntryView";

/** The results in the roll log (newest first), optionally only one kind. */
export function RollLogList({
  kind = "all",
  showClear = false,
  emptyText,
}: {
  kind?: ResultKind | "all";
  /** Offer a "Clear log" button (it clears every kind, not just the ones shown). */
  showClear?: boolean;
  emptyText: string;
}) {
  const all = useRollLog();
  const entries = useMemo(() => (kind === "all" ? all : all.filter((e) => e.kind === kind)), [all, kind]);

  if (entries.length === 0) return <p className="empty">{emptyText}</p>;
  return (
    <>
      <ul className="list">
        {entries.map((entry) => (
          <LogEntryView key={entry.id} entry={entry} />
        ))}
      </ul>
      {showClear && (
        <ConfirmButton label="Clear log" confirmLabel="Tap again to clear" onConfirm={() => rollLog.clear()} />
      )}
    </>
  );
}
