import type { ItemTypeDefinition } from "../../registry/types";
import { DocumentEditor } from "./DocumentEditor";

/**
 * A template's page: a short reminder of what it does, then the same editor as a document (the
 * text here is the starter text). Its Properties and Tags sections below are what new documents get:
 * the property sets applied to it, the values filled in (the defaults), and its tags.
 */
function TemplateEditor({ itemId }: { itemId: string }) {
  return (
    <>
      <p className="meta template-hint">
        This is a template. When you make a document from it, the document gets this text, these tags, the property sets below and the
        values filled in here. Changing the template later doesn't change documents already made from it.
      </p>
      <DocumentEditor itemId={itemId} />
    </>
  );
}

export const templateType: ItemTypeDefinition = {
  id: "template",
  label: "Template",
  icon: "📋",
  toolId: "worldbuilding",
  tabs: true,
  editor: TemplateEditor,
};
