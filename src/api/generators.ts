import { invoke } from "@tauri-apps/api/core";
import type { GeneratorDef } from "../lib/generators/generator";

/** Mirrors the Rust `Generator`. `definitionJson` is read with `parseGenerator` (`lib/generators/generator.ts`). */
export interface GeneratorRecord {
  itemId: string;
  definitionJson: string;
  createdAt: number;
  updatedAt: number;
}

export const getGenerator = (itemId: string) => invoke<GeneratorRecord>("get_generator", { itemId });
export const setGeneratorDefinition = (itemId: string, definition: GeneratorDef | string) =>
  invoke<void>("set_generator_definition", {
    itemId,
    definitionJson: typeof definition === "string" ? definition : JSON.stringify(definition),
  });
