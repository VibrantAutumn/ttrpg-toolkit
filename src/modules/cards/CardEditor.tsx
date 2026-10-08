import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  getCardDetails,
  getCardImage,
  imageSrc,
  listContainers,
  removeCardImage,
  setCardDetails,
  setCardImage,
} from "../../api/cards";
import type { Item } from "../../api/library";
import { ConfirmButton } from "../../components/ConfirmButton";
import { createAutosaver, type Autosaver, type SaveStatus } from "../../lib/autosave";
import { prepareCardImage } from "../../lib/cards/image";
import { bumpDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { cardTypeIcon } from "./icons";

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving...",
  error: "Couldn't save",
};

/** A card's page: its picture, value and notes, and which sets, decks and pools hold it. */
export function CardEditor({ itemId }: { itemId: string }) {
  const { openItem } = useNavigation();
  const [value, setValue] = useState<string | null>(null); // null while loading
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [picture, setPicture] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [containers, setContainers] = useState<Item[]>([]);
  const saver = useRef<Autosaver | null>(null);

  useEffect(() => {
    let active = true;
    const autosaver = createAutosaver({
      // Value and notes are saved together, so they travel as one piece of text.
      save: (text) => {
        const edit = JSON.parse(text) as { value: string; notes: string };
        return setCardDetails(itemId, edit.value, edit.notes);
      },
      delayMs: 800,
      onStatus: (s, e) => {
        if (!active) return;
        setStatus(s);
        setError(e ? String(e) : null);
      },
    });
    saver.current = autosaver;

    getCardDetails(itemId)
      .then((d) => {
        if (!active) return;
        setValue(d.value);
        setNotes(d.notes);
      })
      .catch((e) => active && setError(String(e)));
    getCardImage(itemId)
      .then((image) => active && setPicture(image ? imageSrc(image) : null))
      .catch((e) => active && setError(String(e)));
    listContainers(itemId)
      .then((list) => active && setContainers(list))
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

  function edit(nextValue: string, nextNotes: string) {
    setValue(nextValue);
    setNotes(nextNotes);
    saver.current?.change(JSON.stringify({ value: nextValue, notes: nextNotes }));
  }

  async function choosePicture() {
    setError(null);
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
      });
      if (!path) return;
      setBusy(true);
      const prepared = await prepareCardImage(await readFile(path));
      await setCardImage(itemId, prepared.mime, prepared.image, prepared.thumb);
      const saved = await getCardImage(itemId);
      setPicture(saved ? imageSrc(saved) : null);
      bumpDataVersion();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removePicture() {
    try {
      await removeCardImage(itemId);
      setPicture(null);
      bumpDataVersion();
    } catch (e) {
      setError(String(e));
    }
  }

  if (value === null) {
    return error ? <p className="error">{error}</p> : <p className="empty">Loading...</p>;
  }

  return (
    <div className="card-editor">
      <div className="card-picture">
        {picture ? (
          <img src={picture} alt="The card" />
        ) : (
          <p className="empty">No picture yet.</p>
        )}
        <div className="row wrap">
          <button onClick={choosePicture} disabled={busy}>
            {busy ? "Working..." : picture ? "Replace picture" : "Add picture"}
          </button>
          {picture && <ConfirmButton label="Remove picture" onConfirm={removePicture} />}
        </div>
      </div>

      <label className="field">
        <span>Value</span>
        <input
          value={value}
          onChange={(e) => edit(e.currentTarget.value, notes)}
          onBlur={() => void saver.current?.flush()}
          placeholder="7, XIV, Queen..."
          maxLength={50}
        />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea
          value={notes}
          onChange={(e) => edit(value, e.currentTarget.value)}
          onBlur={() => void saver.current?.flush()}
          placeholder="What this card means, how it plays..."
          rows={5}
        />
      </label>
      <p className={status === "error" ? "error" : "meta"} role="status">
        {STATUS_LABEL[status]}
        {status === "error" && error ? `: ${error}` : ""}
      </p>
      {status !== "error" && error && <p className="error">{error}</p>}

      <h2>In sets, decks and pools</h2>
      {containers.length === 0 ? (
        <p className="empty">Not in any set, deck or pool yet. Add it from one of their pages.</p>
      ) : (
        <ul className="list">
          {containers.map((c) => (
            <li key={c.id}>
              <button className="link name" onClick={() => openItem(c.id)}>
                {cardTypeIcon(c.itemType)} {c.name}
              </button>{" "}
              <small className="meta">{c.itemType}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
