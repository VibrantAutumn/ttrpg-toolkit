import type { LogEntry } from "../../lib/encounters/state";

/** What has happened, newest first. (Undo takes lines back out along with the change that wrote them.) */
export function EncounterLog({ log }: { log: LogEntry[] }) {
  return (
    <section className="encounter-log" aria-label="Action log">
      <h3>Log</h3>
      {log.length === 0 ? (
        <p className="meta">Nothing has happened yet.</p>
      ) : (
        <ol className="log-list" reversed>
          {[...log].reverse().map((e) => (
            <li key={e.id}>
              {e.round > 0 && <span className="meta">R{e.round} </span>}
              {e.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
