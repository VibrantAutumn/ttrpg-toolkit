import { useEffect, useRef, useState } from "react";
import { getDocumentBody, setDocumentBody } from "../../api/library";
import { createAutosaver, type Autosaver, type SaveStatus } from "../../lib/autosave";

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving...",
  error: "Couldn't save",
};

/**
 * A plain text box for a document's Markdown, with autosave: it saves shortly
 * after you stop typing, when you leave the box, when you navigate away, and when
 * the app is hidden (Android can close a hidden app at any time).
 * The Phase 4 rich editor replaces this component.
 */
export function DocumentEditor({ itemId }: { itemId: string }) {
  const [text, setText] = useState<string | null>(null); // null while loading
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const saver = useRef<Autosaver | null>(null);

  useEffect(() => {
    let active = true;
    const autosaver = createAutosaver({
      save: (body) => setDocumentBody(itemId, body),
      delayMs: 800,
      onStatus: (s, e) => {
        if (!active) return;
        setStatus(s);
        setError(e ? String(e) : null);
      },
    });
    saver.current = autosaver;

    getDocumentBody(itemId)
      .then((body) => active && setText(body))
      .catch((e) => active && setError(String(e)));

    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") void autosaver.flush();
    };
    document.addEventListener("visibilitychange", saveWhenHidden);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", saveWhenHidden);
      void autosaver.flush(); // don't lose the last edits when leaving the page
      saver.current = null;
    };
  }, [itemId]);

  if (text === null) {
    return error ? <p className="error">{error}</p> : <p className="empty">Loading...</p>;
  }

  return (
    <div className="doc-editor">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.currentTarget.value);
          saver.current?.change(e.currentTarget.value);
        }}
        onBlur={() => void saver.current?.flush()}
        placeholder="Write here. Markdown works: # Heading, **bold**, - list"
        aria-label="Document text"
        spellCheck
      />
      <p className={status === "error" ? "error" : "meta"} role="status">
        {STATUS_LABEL[status]}
        {status === "error" && error ? `: ${error}` : ""}
      </p>
    </div>
  );
}
