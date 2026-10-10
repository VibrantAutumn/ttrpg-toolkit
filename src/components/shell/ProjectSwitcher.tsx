import { useEffect, useRef, useState } from "react";
import { listProjects, type Project } from "../../api/projects";
import { useCurrentProject } from "../../state/CurrentProject";

/**
 * The project name at the top of the sidebar (like a workspace switcher): tap it to switch to
 * another project, or "Manage projects…" to make, rename, import, export or delete them.
 */
export function ProjectSwitcher({ onManage, onChosen }: { onManage: () => void; onChosen: () => void }) {
  const { project, loading, open } = useCurrentProject();
  const [menu, setMenu] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // The list is read each time the menu opens, so a project made on the Projects screen is there.
  useEffect(() => {
    if (!menu) return;
    let active = true;
    listProjects()
      .then((list) => active && setProjects(list.filter((p) => p.deletedAt === null)))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setMenu(false);
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  async function choose(id: string) {
    setMenu(false);
    try {
      await open(id);
      onChosen();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="project-switcher" ref={root}>
      <button type="button" className="project-button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
        <span aria-hidden="true">🏕️</span>{" "}
        <span className="project-name">{loading ? "Loading..." : (project?.name ?? "No project open")}</span>
        <span aria-hidden="true" className="chevron">
          ▾
        </span>
      </button>
      {menu && (
        <div className="project-menu" role="menu">
          {error && <p className="error">{error}</p>}
          {projects.map((p) => (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={p.id === project?.id} onClick={() => void choose(p.id)}>
              {p.id === project?.id ? "✓ " : ""}
              {p.name}
            </button>
          ))}
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              onManage();
              onChosen();
            }}
          >
            Manage projects…
          </button>
        </div>
      )}
    </div>
  );
}
