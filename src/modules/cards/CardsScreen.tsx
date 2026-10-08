import { useState } from "react";
import { LibraryScreen } from "../../components/library/LibraryScreen";
import { cardItemTypes } from "./cardTypes";
import { DrawTab } from "./DrawTab";
import { StarterDecks } from "./StarterDecks";

/** The Cards tool: the library of cards, sets, decks, pools and saved draws, and a place to draw. */
export function CardsScreen() {
  const [tab, setTab] = useState<"library" | "draw">("library");
  return (
    <section>
      <h1>Cards</h1>
      <div className="row" role="tablist" aria-label="Cards sections">
        <button role="tab" aria-selected={tab === "library"} className={tab === "library" ? "active" : undefined} onClick={() => setTab("library")}>
          Library
        </button>
        <button role="tab" aria-selected={tab === "draw"} className={tab === "draw" ? "active" : undefined} onClick={() => setTab("draw")}>
          Draw
        </button>
      </div>
      {/* Both stay mounted (just hidden) so the library keeps its folder and search. */}
      <div hidden={tab !== "library"}>
        <StarterDecks />
        <LibraryScreen library="cards" title="Card library" itemTypes={cardItemTypes} />
      </div>
      <div hidden={tab !== "draw"}>
        <DrawTab />
      </div>
    </section>
  );
}
