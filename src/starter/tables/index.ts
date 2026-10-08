import type { TableStarterDef } from "../../lib/tables/starterTables";
import { fantasyNames } from "./fantasyNames";
import { questsAndRumors } from "./questsAndRumors";
import { tavernNames } from "./tavernNames";
import { weather } from "./weather";

/**
 * Every starter set of tables, in the order they are offered. All the text is
 * original to this app. To add one: write a `TableStarterDef` and list it here
 * (the tests in `starterTables.test.ts` check it automatically).
 */
export const STARTER_TABLES: readonly TableStarterDef[] = [fantasyNames, tavernNames, questsAndRumors, weather];
