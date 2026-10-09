import type { TemplateStarterDef } from "../../lib/templates/starterTemplates";
import { coreTemplates } from "./core";

/**
 * Every starter set of templates, in the order they are offered. All the text is original to
 * this app. To add one: write a `TemplateStarterDef` and list it here (the tests in
 * `starterTemplates.test.ts` check it automatically).
 */
export const STARTER_TEMPLATES: readonly TemplateStarterDef[] = [coreTemplates];
