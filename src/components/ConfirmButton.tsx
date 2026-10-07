import { useEffect, useState } from "react";

/**
 * A button for destructive actions: the first tap asks "are you sure?" and the
 * second tap does it. (window.confirm is unreliable in Android WebViews.)
 * Backs out by itself after a few seconds or when the button loses focus.
 */
export function ConfirmButton({
  label,
  confirmLabel = "Tap again to confirm",
  onConfirm,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      className={armed ? "danger" : undefined}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
