import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addToCollection,
  listCollectionCandidates,
  listCollectionMembers,
  removeFromCollection,
  resolveCollectionCards,
} from "../../api/cards";
import { getItem, type Item } from "../../api/library";
import { createFilterSet } from "../worldbuilding/filterSets";
import { CardThumb } from "../../components/cards/CardThumb";
import { useThumbs } from "../../components/cards/useThumbs";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { cardTypeIcon } from "./icons";
import { DrawPanel } from "./DrawPanel";
import { PlayStarter } from "./PlayStarter";

const WHAT: Record<string, { holds: string; empty: string }> = {
  set: { holds: "cards", empty: "This set is empty. Add some cards." },
  deck: { holds: "cards and sets", empty: "This deck is empty. Add cards and sets." },
  pool: {
    holds: "cards, sets, decks and filter sets",
    empty: "This pool is empty. Add any mix of cards, sets, decks and filter sets (saved searches, such as every card tagged Major Arcana) to draw from.",
  },
};

/**
 * The page of a set, deck or pool: what is inside it, a picker to add more, and
 * (for decks and pools) every distinct card it reaches, which is what will be drawn from.
 */
export function CollectionEditor({ itemId, kind }: { itemId: string; kind: "set" | "deck" | "pool" }) {
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [members, setMembers] = useState<Item[]>([]);
  const [cards, setCards] = useState<Item[]>([]);
  const [candidates, setCandidates] = useState<Item[]>([]);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [item, m, c, cand] = await Promise.all([
        getItem(itemId),
        listCollectionMembers(itemId),
        resolveCollectionCards(itemId),
        listCollectionCandidates(itemId),
      ]);
      setName(item.name);
      setProjectId(item.projectId);
      setMembers(m);
      setCards(c);
      setCandidates(cand);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [itemId, dataVersion]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Runs a change, then reloads. */
  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await reload();
      bumpDataVersion();
    } catch (e) {
      setError(String(e));
    }
  }

  const memberCardIds = useMemo(() => members.filter((m) => m.itemType === "card").map((m) => m.id), [members]);
  const candidateCardIds = useMemo(
    () => candidates.filter((c) => c.itemType === "card").map((c) => c.id),
    [candidates],
  );
  const resolvedIds = useMemo(() => cards.map((c) => c.id), [cards]);
  const memberThumbs = useThumbs(memberCardIds);
  const candidateThumbs = useThumbs(picking ? candidateCardIds : []);
  const resolvedThumbs = useThumbs(kind === "set" ? [] : resolvedIds);

  const shownCandidates = useMemo(() => {
    const text = filter.trim().toLowerCase();
    return text ? candidates.filter((c) => c.name.toLowerCase().includes(text)) : candidates;
  }, [candidates, filter]);

  const info = WHAT[kind];

  /** Makes a filter set, puts it in this pool and opens it to set up its rules. */
  async function newFilterSet() {
    try {
      const made = await createFilterSet(projectId, filter);
      await addToCollection(itemId, made.id);
      setFilter("");
      setPicking(false);
      await reload();
      bumpDataVersion();
      openItem(made.id);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="collection-editor">
      {error && <p className="error">{error}</p>}

      <h2>
        Inside <small className="meta">({info.holds})</small>
      </h2>
      {members.length === 0 ? (
        <p className="empty">{info.empty}</p>
      ) : (
        <ul className="list">
          {members.map((m) => (
            <li key={m.id} className="row wrap">
              {m.itemType === "card" && <CardThumb src={memberThumbs.get(m.id)} name={m.name} />}
              <span className="name">
                <button className="link name" onClick={() => openItem(m.id)}>
                  {cardTypeIcon(m.itemType)} {m.name}
                </button>{" "}
                <small className="meta">{m.itemType.replace("_", " ")}</small>
              </span>
              <button onClick={() => run(() => removeFromCollection(itemId, m.id))}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      {picking ? (
        <div className="member-picker">
          <div className="row">
            <input
              value={filter}
              onChange={(e) => setFilter(e.currentTarget.value)}
              placeholder={`Filter ${info.holds}...`}
              aria-label="Filter what can be added"
              autoFocus
            />
            <button
              onClick={() => {
                setPicking(false);
                setFilter("");
              }}
            >
              Done
            </button>
          </div>
          {kind === "pool" && (
            <p className="row">
              <button type="button" onClick={newFilterSet}>
                New filter set{filter.trim() ? ` “${filter.trim()}”` : ""}
              </button>
              <span className="meta">Makes a saved search, adds it here and opens it.</span>
            </p>
          )}
          {shownCandidates.length === 0 ? (
            <p className="empty">
              {candidates.length === 0
                ? `Nothing left to add. Make ${info.holds} in the Cards tool first.`
                : "Nothing matches."}
            </p>
          ) : (
            <ul className="list">
              {shownCandidates.map((c) => (
                <li key={c.id} className="row wrap">
                  {c.itemType === "card" && <CardThumb src={candidateThumbs.get(c.id)} name={c.name} />}
                  <span className="name">
                    {cardTypeIcon(c.itemType)} {c.name}{" "}
                    <small className="meta">{c.itemType.replace("_", " ")}</small>
                  </span>
                  <button onClick={() => run(() => addToCollection(itemId, c.id))}>Add</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button onClick={() => setPicking(true)}>Add {info.holds}...</button>
      )}

      <h2>
        {cards.length === 1 ? "1 card in total" : `${cards.length} cards in total`}
      </h2>
      {kind !== "set" && cards.length > 0 && (
        <ul className="card-grid">
          {cards.map((c) => (
            <li key={c.id}>
              <button className="link" onClick={() => openItem(c.id)} title={c.name}>
                <CardThumb src={resolvedThumbs.get(c.id)} name={c.name} />
                <span className="card-grid-name">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {kind !== "set" && (
        <p className="meta">
          A card that is in more than one place here is counted once.
        </p>
      )}

      {name && <DrawPanel sourceId={itemId} sourceName={name} />}
      {name && projectId && <PlayStarter source={{ id: itemId, name, projectId }} />}
    </div>
  );
}
