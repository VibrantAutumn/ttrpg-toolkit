import { useState } from "react";
import { useCurrentProject } from "../../state/CurrentProject";
import { saveToSession } from "../../state/timeActions";

/**
 * "Save to session": adds a result to the end of the current session's log, dated with the in-game moment.
 * Says why when there is no current session. Used by the roll log and by a finished encounter.
 */
export function SaveToSessionButton({ text, title }: { text: string; title?: string }) {
  const { project } = useCurrentProject();
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!project) return;
    setBusy(true);
    const result = await saveToSession(project.id, text, title);
    setBusy(false);
    setProblem(!result.ok);
    setNote(result.ok ? `Added to the log of “${result.sessionName}”.` : result.message);
  }

  return (
    <>
      <button type="button" disabled={!project || busy} onClick={() => void save()}>
        Save to session
      </button>
      {note && (
        <span className={problem ? "error" : "meta"} role={problem ? "alert" : "status"}>
          {note}
        </span>
      )}
    </>
  );
}
