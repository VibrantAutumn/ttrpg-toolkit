import { useEffect, useState } from "react";
import { currentDisplay, subscribeDisplay } from "../../lib/encounters/displayChannel";
import type { PublicView } from "../../lib/encounters/publicView";
import "./playerDisplay.css";

/**
 * The player display: a window for the table's TV or second monitor. It only ever receives a `PublicView` (an encounter
 * with every secret already taken out), so it has nothing secret to show. It reads no database and makes no changes.
 */
export function PlayerDisplay() {
  const [view, setView] = useState<PublicView | null>(() => currentDisplay());

  useEffect(() => {
    document.title = "Player display";
    setView(currentDisplay());
    return subscribeDisplay(setView);
  }, []);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  if (!view) {
    return (
      <main className="pd pd-empty" onDoubleClick={fullscreen}>
        <p>Nothing is being shown.</p>
        <p className="pd-hint">Double-click for full screen.</p>
      </main>
    );
  }

  const heading =
    view.phase === "setup" ? "Getting ready" : view.phase === "finished" ? "The encounter is over" : `Round ${view.round}`;

  return (
    <main className="pd" onDoubleClick={fullscreen}>
      <header className="pd-header">
        <h1>{view.title}</h1>
        <p className="pd-round">
          {heading}
          {view.side && view.phase === "running" ? ` · ${view.side === "party" ? "Party's" : "Foes'"} turn` : ""}
        </p>
      </header>
      {view.combatants.length === 0 ? (
        <p className="pd-hint">No one has joined yet.</p>
      ) : (
        <ol className="pd-list">
          {view.combatants.map((c, i) => (
            <li key={`${c.name}-${i}`} className={["pd-row", `pd-${c.side}`, c.current ? "pd-current" : "", c.defeated ? "pd-defeated" : "", c.acted ? "pd-acted" : ""].filter(Boolean).join(" ")}>
              <span className="pd-name">
                {c.current && <span aria-label="Taking their turn" className="pd-marker">▶</span>}
                {c.name}
              </span>
              <span className="pd-health">{c.defeated ? "Defeated" : c.health}</span>
              <span className="pd-statuses">
                {c.statuses.map((s) => (
                  <span key={s.name} className="pd-status" style={s.color ? { borderColor: s.color, color: s.color } : undefined}>
                    {s.name}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
