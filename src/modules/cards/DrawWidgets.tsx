import { PlayDecksSection } from "./PlayDecksSection";
import { SourceDraw } from "./SourceDraw";

/** The quick tools panel's draw box: choose a set, deck or pool and draw. */
export function QuickDrawWidget() {
  return <SourceDraw showHeading={false} />;
}

/** The quick tools panel's list of decks in play, each with a Draw button. */
export function DecksInPlayWidget() {
  return <PlayDecksSection compact />;
}
