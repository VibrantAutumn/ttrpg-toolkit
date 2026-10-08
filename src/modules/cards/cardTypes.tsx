import type { ItemTypeDefinition } from "../../registry/types";
import { CardEditor } from "./CardEditor";
import { CollectionEditor } from "./CollectionEditor";
import { cardTypeIcon } from "./icons";

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

export const cardItemTypes = [cardType, setType, deckType, poolType];
