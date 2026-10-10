import type { ItemTypeDefinition } from "../../registry/types";
import { GeneratorView } from "./GeneratorView";

/** A set of rolls that fills in a new document (its name, fields and text). Rules in `lib/generators`. */
export const generatorType: ItemTypeDefinition = {
  id: "generator",
  label: "Generator",
  icon: "⚙️",
  toolId: "tables",
  editor: GeneratorView,
};
