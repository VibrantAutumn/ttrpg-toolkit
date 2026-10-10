import { useCurrentProject } from "../state/CurrentProject";

/**
 * Slim bar at the top of the app. For now it shows the open project; later
 * phases add the in-game date, session, weather and party location here.
 * Clicking the project calls `onChangeProject`; Search opens the command palette
 * (the way in on Android, where there is no Ctrl+K); Quick tools opens or closes the
 * panel of small tools (Ctrl+J on a keyboard).
 */
export function StatusBar({
  onChangeProject,
  onOpenPalette,
  onToggleQuickTools,
}: {
  onChangeProject: () => void;
  onOpenPalette: () => void;
  onToggleQuickTools: () => void;
}) {
  const { project, loading } = useCurrentProject();

  return (
    <div className="status-bar">
      <button className="link" onClick={onChangeProject}>
        {loading
          ? "Loading..."
          : project
            ? `🏕️ ${project.name}`
            : "No project open. Choose one"}
      </button>
      <button className="quick-button" onClick={onToggleQuickTools} aria-label="Quick tools">
        ⚡ Quick tools
      </button>
      <button className="search-button" onClick={onOpenPalette} aria-label="Open command palette">
        🔍 Search
      </button>
    </div>
  );
}
