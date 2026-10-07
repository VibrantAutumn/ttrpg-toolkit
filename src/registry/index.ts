import { coreModule } from "../modules/core";
import { createRegistry } from "./registry";

/** The app's registry, with every built-in module registered. Add new modules here. */
export const registry = createRegistry();

for (const module of [coreModule]) {
  registry.register(module);
}
