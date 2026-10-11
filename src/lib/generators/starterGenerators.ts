import { GENERATOR_VERSION, type GeneratorDef } from "./generator";

/**
 * Starter generators: ready-made generators that come with the app. A starter is plain data (a name,
 * a description and the text to roll); `toDefinition` turns it into a real generator. Pure logic.
 */

export interface StarterGeneratorDef {
  /** Unique; also the name of the generator item made. */
  name: string;
  description: string;
  /** What to roll, in the syntax of a table entry. */
  text: string;
}

export function toDefinition(def: StarterGeneratorDef): GeneratorDef {
  return { version: GENERATOR_VERSION, text: def.text };
}
