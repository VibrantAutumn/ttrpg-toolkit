import { useEffect, useState } from "react";
import { installCardBundle, listInstalledStarters } from "../../api/starters";
import { toBundle } from "../../lib/cards/starters";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { STARTER_DECKS, type StarterDeck } from "../../starter";

/**
 * "Add starter decks": ready-made decks that come with the app. Adding one puts
 * ordinary cards, sets and a deck in the open project (all or nothing); after
 * that they are yours to rename, edit or delete.
 */
export function StarterDecks() {
  const { project } = useCurrentProject();
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;
  const [installed, setInstalled] = useState<readonly string[]>([]);
  const [working, setWorking] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ name: string; deckId: string } | null>(null);

  useEffect(() => {
    if (!projectId) {
      setInstalled([]);
      return;
    }
    let active = true;
    listInstalledStarters(projectId)
      .then((ids) => active && setInstalled(ids))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  async function add(starter: StarterDeck) {
    if (!projectId || working) return;
    setError(null);
    setAdded(null);
    const { id, name } = starter.def;
    setWorking({ id, text: "Preparing pictures..." });
    try {
      const images = await starter.makeImages((done, total) =>
        setWorking({ id, text: `Preparing pictures... ${done} of ${total}` }),
      );
      setWorking({ id, text: "Adding to the project..." });
      const result = await installCardBundle(projectId, toBundle(starter.def, images));
      bumpDataVersion();
      setAdded({ name, deckId: result.deckId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(null);
    }
  }

  if (!projectId) return null;

  return (
    <details className="starter-decks">
      <summary>Add starter decks</summary>
      <p className="meta">
        Ready-made decks that come with the app. They are added to this project as ordinary cards you can rename,
        edit or delete.
      </p>
      <ul className="list">
        {STARTER_DECKS.map((starter) => {
          const { id, name } = starter.def;
          const isInstalled = installed.includes(id);
          return (
            <li key={id} className="row wrap">
              <span className="name">
                <strong>{name}</strong> <small className="meta">{starter.def.cards.length} cards</small>
                <br />
                <small className="meta">{starter.description}</small>
              </span>
              <button
                onClick={() => void add(starter)}
                disabled={isInstalled || working !== null}
                aria-label={isInstalled ? `${name} is already added` : `Add ${name}`}
              >
                {working?.id === id ? working.text : isInstalled ? "Added ✓" : "Add"}
              </button>
            </li>
          );
        })}
      </ul>
      {added && (
        <p className="notice" role="status">
          Added {added.name}.{" "}
          <button className="link" onClick={() => openItem(added.deckId)}>
            Open the deck
          </button>
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </details>
  );
}
