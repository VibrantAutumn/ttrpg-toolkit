import { useCallback, useEffect, useState } from "react";
import {
  Project,
  createProject,
  deleteProject,
  getSchemaVersion,
  listProjects,
  renameProject,
  restoreProject,
} from "../../api/projects";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { exportProjectPack } from "../../api/packs";
import { packFileName } from "../../lib/packs";
import { useCurrentProject } from "../../state/CurrentProject";
import { ImportPack } from "./ImportPack";

export function ProjectsScreen() {
  const current = useCurrentProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [justDeleted, setJustDeleted] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [schemaVersion, setSchemaVersion] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setProjects(await listProjects());
  }, []);

  /** Runs a change, then reloads the list and the open project. Shows any error from Rust. */
  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
      await current.refresh(); // renames, deletes and undo can all change the open project
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    getSchemaVersion().then(setSchemaVersion);
  }, [refresh]);

  function startEditing(c: Project) {
    setEditingId(c.id);
    setEditName(c.name);
  }

  /** Builds the project's pack, asks where to save it, and writes the file. */
  async function exportProject(c: Project) {
    setStatus(null);
    try {
      const bytes = await exportProjectPack(c.id);
      const target = await save({ defaultPath: packFileName(c.name) });
      if (!target) return; // the user cancelled
      await writeFile(target, bytes);
      setStatus(`Exported “${c.name}”.`);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section>
      <h1>Projects</h1>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await createProject(newName);
            setNewName("");
          });
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.currentTarget.value)}
          placeholder="New project name..."
          aria-label="New project name"
        />
        <button type="submit">Create</button>
      </form>

      <ImportPack onImported={() => run(async () => {})} />

      {error && <p className="error">{error}</p>}
      {status && <p className="notice">{status}</p>}

      {justDeleted && (
        <p className="notice">
          Deleted “{justDeleted.name}”.{" "}
          <button
            className="link"
            onClick={() =>
              run(async () => {
                await restoreProject(justDeleted.id);
                setJustDeleted(null);
              })
            }
          >
            Undo
          </button>
        </p>
      )}

      {projects.length === 0 ? (
        <p className="empty">No projects yet. Create one above to get started.</p>
      ) : (
        <ul className="list">
          {projects.map((c) => (
            <li key={c.id}>
              {editingId === c.id ? (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      await renameProject(c.id, editName);
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
                <div className="row wrap">
                  <span className="name">{c.name}</span>
                  {current.project?.id === c.id ? (
                    <span className="badge">✓ Open</span>
                  ) : (
                    <button onClick={() => run(() => current.open(c.id))}>Open</button>
                  )}
                  <button onClick={() => startEditing(c)}>Rename</button>
                  <button onClick={() => exportProject(c)}>Export</button>
                  <button
                    onClick={() =>
                      run(async () => {
                        await deleteProject(c.id);
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
