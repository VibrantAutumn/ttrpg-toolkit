import { useCallback, useEffect, useState } from "react";
import {
  Campaign,
  createCampaign,
  deleteCampaign,
  getSchemaVersion,
  listCampaigns,
  renameCampaign,
  restoreCampaign,
} from "../../api/campaigns";

export function CampaignsScreen() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [justDeleted, setJustDeleted] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schemaVersion, setSchemaVersion] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setCampaigns(await listCampaigns());
  }, []);

  /** Runs a change, then reloads the list. Shows any error from Rust. */
  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    getSchemaVersion().then(setSchemaVersion);
  }, [refresh]);

  function startEditing(c: Campaign) {
    setEditingId(c.id);
    setEditName(c.name);
  }

  return (
    <section>
      <h1>Campaigns</h1>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await createCampaign(newName);
            setNewName("");
          });
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.currentTarget.value)}
          placeholder="New campaign name..."
          aria-label="New campaign name"
        />
        <button type="submit">Create</button>
      </form>

      {error && <p className="error">{error}</p>}

      {justDeleted && (
        <p className="notice">
          Deleted “{justDeleted.name}”.{" "}
          <button
            className="link"
            onClick={() =>
              run(async () => {
                await restoreCampaign(justDeleted.id);
                setJustDeleted(null);
              })
            }
          >
            Undo
          </button>
        </p>
      )}

      {campaigns.length === 0 ? (
        <p className="empty">No campaigns yet. Create one above to get started.</p>
      ) : (
        <ul className="list">
          {campaigns.map((c) => (
            <li key={c.id}>
              {editingId === c.id ? (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      await renameCampaign(c.id, editName);
                      setEditingId(null);
                    });
                  }}
                >
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.currentTarget.value)}
                    aria-label={`Rename ${c.name}`}
                    autoFocus
                  />
                  <button type="submit">Save</button>
                  <button type="button" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="row">
                  <span className="name">{c.name}</span>
                  <button onClick={() => startEditing(c)}>Rename</button>
                  <button
                    onClick={() =>
                      run(async () => {
                        await deleteCampaign(c.id);
                        setJustDeleted(c);
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <footer>Database schema version: {schemaVersion ?? "loading..."}</footer>
    </section>
  );
}
