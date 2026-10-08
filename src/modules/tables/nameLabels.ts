import type { Capitalisation, NameMode, Separator } from "../../lib/tables/nameGen";

/** How the name generator's choices are worded to the person. */
export const MODE_LABELS: Record<NameMode, string> = {
  full: "One part (a whole name)",
  two: "Two parts",
  three: "Three parts",
};

export const SEPARATOR_LABELS: Record<Separator, string> = {
  none: "Nothing (Aelwen)",
  space: "A space (Anna Marie)",
  hyphen: "A hyphen (Anna-Marie)",
  apostrophe: "An apostrophe (Kel'drin)",
};

export const CAPITALISATION_LABELS: Record<Capitalisation, string> = {
  asTyped: "As typed in the tables",
  firstLetter: "First letter of the name",
  everyPart: "First letter of every part",
};
