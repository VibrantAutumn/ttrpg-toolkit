import type { ModuleDefinition } from "../../registry/types";
import { cardItemTypes } from "./cardTypes";
import { CardsScreen } from "./CardsScreen";
import { DecksInPlayWidget, QuickDrawWidget } from "./DrawWidgets";

/**
 * Cards, sets, decks and pools. A pool is a saved, reusable selection of cards,
 * sets and decks that can be drawn from (drawing arrives in a later step).
 */
export const cardsModule: ModuleDefinition = {
  id: "cards",
  tools: [
    {
      id: "cards",
      label: "Cards",
      icon: "🃏",
      order: 15,
      component: CardsScreen,
    },
  ],
  itemTypes: cardItemTypes,
  widgets: [
    { id: "cards.quick-draw", label: "Quick draw", icon: "🃏", order: 20, component: QuickDrawWidget },
    { id: "cards.decks-in-play", label: "Decks in play", icon: "▶️", order: 30, component: DecksInPlayWidget },
  ],
  commands: [
    {
      id: "cards.open",
      label: "Go to Cards",
      keywords: ["cards", "deck", "decks", "tarot", "pool", "set"],
      run: (ctx) => ctx.openTool("cards"),
    },
  ],
};
