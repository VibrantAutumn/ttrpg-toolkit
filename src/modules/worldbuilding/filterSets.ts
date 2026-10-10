import { createItem, type Item } from "../../api/library";

/** Filter sets are stored as the `smart_collection` item type in the worldbuilding library. */
export const FILTER_SET_LIBRARY = "worldbuilding";
export const FILTER_SET_TYPE = "smart_collection";

/**
 * Makes an empty filter set (it finds everything until rules are added). Filter sets are made where
 * filters are used (a card pool's Add picker, for now), not from a list of their own.
 */
export const createFilterSet = (projectId: string, name: string): Promise<Item> =>
  createItem(projectId, FILTER_SET_LIBRARY, FILTER_SET_TYPE, name.trim() || "New filter set", null);
