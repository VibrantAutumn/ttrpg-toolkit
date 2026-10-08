import { useCurrentCampaign } from "../state/CurrentCampaign";

/**
 * Slim bar at the top of the app. For now it shows the open campaign; later
 * phases add the in-game date, session, weather and party location here.
 * Clicking the campaign calls `onChangeCampaign`; Search opens the command palette
 * (the way in on Android, where there is no Ctrl+K).
 */
export function StatusBar({
  onChangeCampaign,
  onOpenPalette,
}: {
  onChangeCampaign: () => void;
  onOpenPalette: () => void;
}) {
  const { campaign, loading } = useCurrentCampaign();

  return (
    <div className="status-bar">
      <button className="link" onClick={onChangeCampaign}>
        {loading
          ? "Loading..."
          : campaign
            ? `🏕️ ${campaign.name}`
            : "No campaign open. Choose one"}
      </button>
      <button className="search-button" onClick={onOpenPalette} aria-label="Open command palette">
        🔍 Search
      </button>
    </div>
  );
}
