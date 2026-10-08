import type { ItemTypeDefinition } from "../../registry/types";
import { CardEditor } from "./CardEditor";
import { CollectionEditor } from "./CollectionEditor";
import { cardTypeIcon } from "./icons";
import { PlayDeckView } from "./PlayDeckView";
import { SavedDrawView } from "./SavedDrawView";
import { SpreadEditor } from "./SpreadEditor";

export const cardType: ItemTypeDefinition = {
  id: "card",
  label: "Card",
  icon: cardTypeIcon("card"),
  toolId: "cards",
  editor: CardEditor,
};

export const setType: ItemTypeDefinition = {
  id: "set",
  label: "Set",
  icon: cardTypeIcon("set"),
  toolId: "cards",
  editor: ({ itemId }) => <CollectionEditor itemId={itemId} kind="set" />,
};

export const deckType: ItemTypeDefinition = {
  id: "deck",
  label: "Deck",
  icon: cardTypeIcon("deck"),
  toolId: "cards",
  editor: ({ itemId }) => <CollectionEditor itemId={itemId} kind="deck" />,
};

export const poolType: ItemTypeDefinition = {
  id: "pool",
  label: "Pool",
  icon: cardTypeIcon("pool"),
  toolId: "cards",
  editor: ({ itemId }) => <CollectionEditor itemId={itemId} kind="pool" />,
};

/** A saved draw is made from the Draw panel or the roll log, never from the "New item" form. */
export const drawType: ItemTypeDefinition = {
  id: "draw",
  label: "Saved draw",
  icon: cardTypeIcon("draw"),
  toolId: "cards",
  creatable: false,
  editor: SavedDrawView,
};

/** A deck in play is started from a set, deck or pool page, never from the "New item" form. */
export const playType: ItemTypeDefinition = {
  id: "play",
  label: "Deck in play",
  icon: cardTypeIcon("play"),
  toolId: "cards",
  creatable: false,
  editor: PlayDeckView,
};

/** A spread starts empty from the library's "New item" form; its page is where the positions are built. */
export const spreadType: ItemTypeDefinition = {
  id: "spread",
  label: "Spread",
  icon: cardTypeIcon("spread"),
  toolId: "cards",
  editor: SpreadEditor,
};

export const cardItemTypes = [cardType, setType, deckType, poolType, spreadType, drawType, playType];
