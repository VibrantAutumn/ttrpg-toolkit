import { useCurrentProject } from "../../state/CurrentProject";

/**
 * Home: the place the project's dashboards will live (dashboards you make and arrange yourself,
 * as many as you like, arrive with Phase 8). Until then it just points at the sidebar.
 */
export function HomeScreen() {
  const { project } = useCurrentProject();
  return (
    <section>
      <h1>{project ? project.name : "Home"}</h1>
      <p className="empty">
        Pick a page from the sidebar, or make one with “+ Page”. Dashboards you can build and arrange yourself will appear here in a
        later update.
      </p>
    </section>
  );
}
