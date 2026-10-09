import { useEffect, useState } from "react";
import { createFromTemplate, listItemsOfType, type Item } from "../../api/library";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { itemIcon } from "../../components/item/itemDisplay";
import { StarterTemplates } from "./StarterTemplates";

/**
 * "New from template": pick a template, name the new document, and it is made in the folder
 * you are looking at (with the template's text, tags, field sets and default values) and opened.
 */
export function NewFromTemplate({ folderId }: { folderId: string | null }) {
  const { campaign } = useCurrentCampaign();
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const campaignId = campaign?.id ?? null;
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Item[]>([]);
  const [chosen, setChosen] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !campaignId) return;
    let active = true;
    listItemsOfType(campaignId, "worldbuilding", "template")
      .then((found) => {
        if (!active) return;
        setTemplates(found);
        setChosen((current) => (found.some((t) => t.id === current) ? current : (found[0]?.id ?? "")));
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [open, campaignId, dataVersion]);

  const template = templates.find((t) => t.id === chosen);

  async function make(e: React.FormEvent) {
    e.preventDefault();
    if (!template) return;
    try {
      const made = await createFromTemplate(template.id, name.trim() || `New ${template.name}`, folderId);
      bumpDataVersion();
      setName("");
      setOpen(false);
      setError(null);
      openItem(made.id);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="new-from-template">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Close" : "New from template…"}
      </button>
      {open && (
        <div className="template-panel">
          {templates.length === 0 ? (
            <p className="empty">No templates yet. Add the starter templates below, or make one with New item, choosing the Template type.</p>
          ) : (
            <form className="row wrap" onSubmit={make}>
              <select aria-label="Template" value={chosen} onChange={(e) => setChosen(e.currentTarget.value)}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {itemIcon(t)} {t.name}
                  </option>
                ))}
              </select>
              <input
                className="grow"
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                placeholder={template ? `New ${template.name}` : "Name"}
                aria-label="Name of the new document"
              />
              <button type="submit">Make document</button>
            </form>
          )}
          {error && <p className="error">{error}</p>}
          <details className="starter-decks">
            <summary>Add starter templates</summary>
            <StarterTemplates />
          </details>
        </div>
      )}
    </div>
  );
}
