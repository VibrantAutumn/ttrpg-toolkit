import { useEffect, useState } from "react";
import { listTags, type Tag } from "../../api/library";
import { toggleContextTag } from "../../lib/tables/rollContext";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { useDataVersion } from "../../state/dataVersion";
import { setRollContext, useRollContext } from "../../state/rollContext";

/**
 * "Only documents tagged...": limits what entity slots (`[Person]`) may pick in every roll on this device.
 * An item has to carry every chosen tag. Hidden behind a toggle until used, so ordinary rolls stay simple.
 */
export function RollContextBar() {
  const { campaign } = useCurrentCampaign();
  const dataVersion = useDataVersion();
  const campaignId = campaign?.id ?? null;
  const chosen = useRollContext(campaignId);
  const [tags, setTags] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!campaignId) {
      setTags([]);
      return;
    }
    let active = true;
    listTags(campaignId)
      .then((t) => active && setTags(t))
      .catch(() => active && setTags([]));
    return () => {
      active = false;
    };
  }, [campaignId, dataVersion]);

  if (!campaignId || tags.length === 0) return null;
  const names = chosen.map((id) => tags.find((t) => t.id === id)?.name).filter((n): n is string => n !== undefined);

  return (
    <div className="roll-context">
      <div className="row wrap">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          Roll context: {names.length === 0 ? "none" : names.join(" + ")}
        </button>
        {names.length > 0 && (
          <button type="button" onClick={() => setRollContext(campaignId, [])}>
            Clear
          </button>
        )}
      </div>
      {open && (
        <>
          <p className="meta">Documents picked by slots like [Person] must carry every tag chosen here.</p>
          <div className="chips">
            {tags.map((t) => {
              const on = chosen.includes(t.id);
              return (
                <button key={t.id} type="button" className={on ? "chip on" : "chip"} aria-pressed={on} onClick={() => setRollContext(campaignId, toggleContextTag(chosen, t.id))}>
                  {t.name}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
