import { cardsModule } from "../modules/cards";
import { coreModule } from "../modules/core";
import { diceModule } from "../modules/dice";
import { encountersModule } from "../modules/encounters";
import { rulesetsModule } from "../modules/rulesets";
import { tablesModule } from "../modules/tables";
import { worldbuildingModule } from "../modules/worldbuilding";
import { createRegistry } from "./registry";

/** The app's registry, with every built-in module registered. Add new modules here. */
export const registry = createRegistry();

for (const module of [coreModule, worldbuildingModule, cardsModule, diceModule, tablesModule, rulesetsModule, encountersModule]) {
  registry.register(module);
}
