import { useEffect, useMemo, useRef, useState } from "react";
import { getDocumentBody, getItem, getItems, searchItems, setDocumentBody } from "../../api/library";
import { createAutosaver, type Autosaver, type SaveStatus } from "../../lib/autosave";
import { markdownToDoc } from "../../lib/documents/markdown";
import { mentionIds } from "../../lib/documents/mentions";
import { bumpDataVersion } from "../../state/dataVersion";
import { deviceStorage } from "../../state/deviceStorage";
import { useNavigation } from "../../state/Navigation";
import type { MentionSupport } from "./mentionNode";
import { RichEditor, type RichEditorHandle } from "./RichEditor";

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving...",
  error: "Couldn't save",
};

type Mode = "rich" | "markdown";
const MODE_KEY = "documents.editorMode";

/** Which view was used last on this device. Only a convenience: unreadable storage means "rich". */
function loadMode(): Mode {
  try {
    return deviceStorage()?.getItem(MODE_KEY) === "markdown" ? "markdown" : "rich";
  } catch {
    return "rich";
  }
}

function saveMode(mode: Mode) {
  try {
    deviceStorage()?.setItem(MODE_KEY, mode);
  } catch {
    // Not remembered; nothing else is affected.
  }
}

/**
 * A document's editor. The rich view is the everyday one; the Markdown view shows the
 * stored text itself (the way to see or change anything the rich view shows as "as
 * written", like tables). Both save through the same autosave: shortly after you stop
 * typing, when you leave the text, when you navigate away, and when the app is hidden
 * (Android can close a hidden app at any time).
 */
export function DocumentEditor({ itemId }: { itemId: string }) {
  const [text, setText] = useState<string | null>(null); // the text a view starts from; null while loading
  const [mode, setMode] = useState<Mode>(loadMode);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [richKey, setRichKey] = useState(0);
  const saver = useRef<Autosaver | null>(null);
  const latest = useRef<string>(""); // the newest text from whichever view is showing
  const rich = useRef<RichEditorHandle | null>(null);
  const { openItem } = useNavigation();
  const campaignId = useRef<string | null>(null);

  // What "@" needs: search the open campaign (never the document itself), look up names, open items.
  const mentions = useMemo<MentionSupport>(
    () => ({
      search: async (query) => {
        if (!campaignId.current) return [];
        const found = await searchItems(campaignId.current, query, null, 8);
        return found.filter((i) => i.id !== itemId);
      },
      lookup: (ids) => getItems(ids),
      open: openItem,
    }),
    [itemId, openItem],
  );

  useEffect(() => {
    let active = true;
    let lastMentions = "";
    getItem(itemId)
      .then((item) => {
        campaignId.current = item.campaignId;
      })
      .catch(() => {});
    const autosaver = createAutosaver({
      save: async (body) => {
        // The items the text mentions go with the text, so the links always match what is written.
        const mentioned = mentionIds(markdownToDoc(body));
        await setDocumentBody(itemId, body, mentioned);
        const key = mentioned.join(",");
        if (key !== lastMentions) {
          lastMentions = key;
          bumpDataVersion(); // the item page's Links and "Linked from" lists change
        }
      },
      delayMs: 800,
      onStatus: (s, e) => {
        if (!active) return;
        setStatus(s);
        setError(e ? String(e) : null);
      },
    });
    saver.current = autosaver;

    getDocumentBody(itemId)
      .then((body) => {
        if (!active) return;
        latest.current = body;
        setText(body);
      })
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

  function changeText(markdown: string) {
    latest.current = markdown;
    saver.current?.change(markdown);
  }

  function switchMode(next: Mode) {
    rich.current?.commit(); // get the rich view's newest edits into `latest`
    setText(latest.current);
    if (next === "rich") setRichKey((k) => k + 1); // a fresh editor reads the text
    setMode(next);
    saveMode(next);
  }

  return (
    <div className="doc-editor">
      {mode === "rich" ? (
        <RichEditor
          key={richKey}
          ref={rich}
          initial={text}
          mentions={mentions}
          onMarkdown={changeText}
          onFlush={() => void saver.current?.flush()}
        />
      ) : (
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            changeText(e.currentTarget.value);
          }}
          onBlur={() => void saver.current?.flush()}
          placeholder="Write here. Markdown works: # Heading, **bold**, - list"
          aria-label="Document text (Markdown)"
          spellCheck
        />
      )}
      <div className="doc-editor-foot row">
        <p className={status === "error" ? "error grow" : "meta grow"} role="status">
          {STATUS_LABEL[status]}
          {status === "error" && error ? `: ${error}` : ""}
        </p>
        <button type="button" className="link" onClick={() => switchMode(mode === "rich" ? "markdown" : "rich")}>
          {mode === "rich" ? "Edit as Markdown" : "Back to rich editor"}
        </button>
      </div>
    </div>
  );
}
