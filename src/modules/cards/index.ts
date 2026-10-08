import type { ModuleDefinition } from "../../registry/types";
import { cardItemTypes } from "./cardTypes";
import { CardsScreen } from "./CardsScreen";

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
  commands: [
    {
      id: "cards.open",
      label: "Go to Cards",
      keywords: ["cards", "deck", "decks", "tarot", "pool", "set"],
      run: (ctx) => ctx.openTool("cards"),
    },
  ],
};
