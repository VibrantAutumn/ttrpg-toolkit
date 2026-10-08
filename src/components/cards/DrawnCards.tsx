import type { DrawnCard } from "../../lib/cards/draw";
import { CardThumb } from "./CardThumb";
import { useThumbs } from "./useThumbs";

/**
 * The cards of a draw, in order, with their pictures (upside-down when reversed)
 * and names. Cards that no longer exist simply show a placeholder.
 */
export function DrawnCards({ cards }: { cards: readonly DrawnCard[] }) {
  const thumbs = useThumbs(cards.map((c) => c.id));
  return (
    <ol className="drawn-cards">
      {cards.map((card, i) => (
        <li key={i} className="drawn-card">
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
