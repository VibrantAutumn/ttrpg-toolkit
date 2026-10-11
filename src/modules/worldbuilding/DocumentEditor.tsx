import { useEffect, useMemo, useRef, useState } from "react";
import { applyFieldSet } from "../../api/fields";
import { getDocumentBody, getItem, getItems, searchItems, setDocumentBody } from "../../api/library";
import { createAutosaver, type Autosaver, type SaveStatus } from "../../lib/autosave";
import { projectStatBlocks } from "../../lib/rulesets/projectRules";
import { markdownToDoc } from "../../lib/documents/markdown";
import { mentionIds } from "../../lib/documents/mentions";
import { bumpDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { useProjectRules } from "../../state/projectRules";
import type { MentionSupport } from "./mentionNode";
import { RichEditor, type StatBlockSupport } from "./RichEditor";

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving...",
  error: "Couldn't save",
};

/**
 * A document's editor (the rich editor, saved as Markdown). It saves through one autosave: shortly after you stop
 * typing, when you leave the text, when you navigate away, and when the app is hidden
 * (Android can close a hidden app at any time).
 */
export function DocumentEditor({ itemId }: { itemId: string }) {
  const [text, setText] = useState<string | null>(null); // the text a view starts from; null while loading
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const saver = useRef<Autosaver | null>(null);
  const latest = useRef<string>(""); // the newest text from whichever view is showing
  const { openItem } = useNavigation();
  const projectId = useRef<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const { rules } = useProjectRules(project);

  // What "/" needs to add a stat block (a property set of one of the project's rulesets) to this page.
  const statBlocks = useMemo<StatBlockSupport>(
    () => ({
      list: () =>
        projectStatBlocks(rules)
          .filter((b) => b.setId !== null)
          .map((b) => ({ setId: b.setId as string, name: b.block.name, rulesName: rules.length > 1 ? b.rulesName : "" })),
      add: (setId) => {
        applyFieldSet(itemId, setId)
          .then(() => bumpDataVersion()) // the page's Properties panel shows it
          .catch((e) => setError(String(e)));
      },
    }),
    [rules, itemId],
  );

  // What "@" needs: search the open project (never the document itself), look up names, open items.
  const mentions = useMemo<MentionSupport>(
    () => ({
      search: async (query) => {
        if (!projectId.current) return [];
        const found = await searchItems(projectId.current, query, null, 8);
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
        projectId.current = item.projectId;
        if (active) setProject(item.projectId);
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

  return (
    <div className="doc-editor">
      <RichEditor initial={text} mentions={mentions} statBlocks={statBlocks} onMarkdown={changeText} onFlush={() => void saver.current?.flush()} />
      <div className="doc-editor-foot row">
        <p className={status === "error" ? "error grow" : "meta grow"} role="status">
          {STATUS_LABEL[status]}
          {status === "error" && error ? `: ${error}` : ""}
        </p>
      </div>
    </div>
  );
}
