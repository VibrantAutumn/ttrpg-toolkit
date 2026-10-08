import { LibraryScreen } from "../../components/library/LibraryScreen";
import { cardItemTypes } from "./cardTypes";

/** The Cards tool: cards, sets, decks and pools, organised in folders. */
export function CardsScreen() {
  return <LibraryScreen library="cards" title="Cards" itemTypes={cardItemTypes} />;
}
