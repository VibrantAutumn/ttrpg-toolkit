import { useState } from "react";
import { startPlayDeck } from "../../state/playActions";
import { useNavigation } from "../../state/Navigation";

/**
 * "Start a deck in play" on a set, deck or pool page: makes a shuffled copy of
 * the cards it holds right now, and opens it. The original is never changed by playing.
 */
export function PlayStarter({
  source,
}: {
  source: { id: string; name: string; projectId: string };
}) {
  const { openItem } = useNavigation();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    try {
      const item = await startPlayDeck(source, name.trim() || `${source.name} in play`);
      setName("");
      setError(null);
      openItem(item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="play-starter">
      <h2>Deck in play</h2>
      <p className="meta">
        Play with a shuffled copy of these cards. Drawn cards stay out until you return them or reshuffle, and
        several games can run at once.
      </p>
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={`${source.name} in play`}
          aria-label="Name for the new game"
        />
        <button type="submit" disabled={busy}>
          {busy ? "Starting..." : "Start playing"}
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
