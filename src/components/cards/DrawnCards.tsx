import type { DrawnCard } from "../../lib/cards/draw";
import { CardThumb } from "./CardThumb";
import { useThumbs } from "./useThumbs";

/**
 * The cards of a draw, in order, with their pictures (upside-down when reversed)
 * and names. Cards that no longer exist simply show a placeholder.
 */
export function DrawnCards({
  cards,
  positions = null,
}: {
  cards: readonly DrawnCard[];
  /** For a spread reading: the position name of each card, in the same order. */
  positions?: readonly string[] | null;
}) {
  const thumbs = useThumbs(cards.map((c) => c.id));
  return (
    <ol className="drawn-cards">
      {cards.map((card, i) => (
        <li key={i} className="drawn-card">
          {positions && positions[i] !== undefined && <span className="position-name">{positions[i]}</span>}
          <CardThumb src={thumbs.get(card.id)} name={card.name} reversed={card.reversed} large />
          <span className="card-grid-name">
            {card.name}
            {card.reversed && <small className="meta"> (reversed)</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}
