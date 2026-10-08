/** A small card picture, or a plain placeholder when the card has none. */
export function CardThumb({ src, name }: { src: string | undefined; name: string }) {
  return src ? (
    <img className="card-thumb" src={src} alt={name} loading="lazy" />
  ) : (
    <span className="card-thumb card-thumb-empty" role="img" aria-label={`${name} (no picture)`}>
      🃏
    </span>
  );
}
