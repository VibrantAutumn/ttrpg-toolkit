/**
 * A small card picture, or a plain placeholder when the card has none.
 * A reversed card is shown upside-down; `large` is the size used in results.
 */
export function CardThumb({
  src,
  name,
  reversed = false,
  large = false,
}: {
  src: string | undefined;
  name: string;
  reversed?: boolean;
  large?: boolean;
}) {
  const classes = ["card-thumb", large ? "large" : "", reversed ? "reversed" : ""].filter(Boolean).join(" ");
  const label = reversed ? `${name} (reversed)` : name;
  return src ? (
    <img className={classes} src={src} alt={label} loading="lazy" />
  ) : (
    <span className={`${classes} card-thumb-empty`} role="img" aria-label={`${label} (no picture)`}>
      🃏
    </span>
  );
}
