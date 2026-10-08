import { useEffect, useState } from "react";
import { getCardThumbs, imageSrc } from "../../api/cards";

/**
 * Thumbnail pictures for some cards, as `<img>`-ready sources by card id (cards
 * without a picture are simply absent). Reloads when the list of ids changes or
 * when `refresh` does (bump it after a picture is changed).
 */
export function useThumbs(ids: readonly string[], refresh = 0): ReadonlyMap<string, string> {
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());
  const key = ids.join(",");

  useEffect(() => {
    if (ids.length === 0) {
      setThumbs(new Map());
      return;
    }
    let active = true;
    // Ask in batches so a big pool never trips the per-request limit.
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 200) batches.push(ids.slice(i, i + 200));
    Promise.all(batches.map((batch) => getCardThumbs(batch)))
      .then((results) => {
        if (!active) return;
        setThumbs(new Map(results.flat().map((t) => [t.itemId, imageSrc(t)])));
      })
      .catch(() => active && setThumbs(new Map()));
    return () => {
      active = false;
    };
    // `key` stands for `ids`: the array is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh]);

  return thumbs;
}
