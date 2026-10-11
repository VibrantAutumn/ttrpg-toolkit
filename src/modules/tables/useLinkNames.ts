import { useEffect, useState } from "react";
import { getItems } from "../../api/library";
import { rememberLinkNames } from "../../lib/tables/linkNames";
import { linkIdsIn } from "../../lib/tables/world";
import { useDataVersion } from "../../state/dataVersion";

/**
 * Loads the current names of the pages an entry's link slots point at, so its chips show them (and
 * follow a rename). Returns a number that changes when a name did, to redraw with. A page that is gone
 * or in the trash keeps the name it was linked with.
 */
export function useLinkNames(text: string): number {
  const dataVersion = useDataVersion();
  const [version, setVersion] = useState(0);
  const ids = linkIdsIn([text]).join(",");

  useEffect(() => {
    if (ids === "") return;
    let active = true;
    getItems(ids.split(","))
      .then((items) => {
        const live = items.filter((i) => i.deletedAt === null).map((i) => [i.id, i.name] as const);
        if (active && rememberLinkNames(live)) setVersion((v) => v + 1);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [ids, dataVersion]);

  return version;
}
