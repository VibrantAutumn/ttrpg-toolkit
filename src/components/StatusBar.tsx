import { useCurrentCampaign } from "../state/CurrentCampaign";

/**
 * Slim bar at the top of the app. For now it shows the open campaign; later
 * phases add the in-game date, session, weather and party location here.
 * Clicking it calls `onChangeCampaign`.
 */
export function StatusBar({ onChangeCampaign }: { onChangeCampaign: () => void }) {
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
    </div>
  );
}
