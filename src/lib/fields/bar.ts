import type { BarValue } from "./value";

/** How full a bar is, from 0 to 1 (an unset bar, or one with no maximum, is empty). */
export function barFraction(bar: BarValue | null): number {
  if (!bar || bar.max <= 0) return 0;
  return Math.min(1, Math.max(0, bar.current / bar.max));
}

const tidy = (n: number) => Math.round(n * 1e9) / 1e9;

/**
 * Adds `delta` (negative to subtract) to the current value. By default it stays between 0 and
 * the maximum: healing stops at the maximum, damage at zero. A value already beyond a limit
 * (temporary points over the maximum) is not pulled back by something that moves it further out.
 * Pass `{ limit: false }` to go past the limits.
 */
export function adjustBar(bar: BarValue | null, delta: number, options: { limit?: boolean } = {}): BarValue {
  const { current, max } = bar ?? { current: 0, max: 0 };
  let next = current + delta;
  if (options.limit !== false) {
    if (delta > 0) next = current >= max ? current : Math.min(next, max);
    else if (delta < 0) {
      next = current <= 0 ? current : Math.max(next, 0);
      if (current > max) next = Math.min(next, max);
    }
  }
  return { current: tidy(next), max };
}

export type BarInputResult = { ok: true; value: BarValue | null } | { ok: false; error: string };

const NUMBER = "\\d+(?:[.,]\\d+)?";
const toNumber = (text: string) => Number(text.replace(",", "."));

/**
 * Reads what someone typed into a bar: `22/30` (current and maximum), `9` (a new current
 * value), `+5` or `-5` (a change), `/40` (a new maximum), or nothing (clears it).
 */
export function parseBarInput(text: string, previous: BarValue | null): BarInputResult {
  const input = text.trim();
  if (input === "") return { ok: true, value: null };
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^(${NUMBER})\\s*/\\s*(${NUMBER})$`).exec(input))) {
    return { ok: true, value: { current: toNumber(m[1]), max: toNumber(m[2]) } };
  }
  if ((m = new RegExp(`^/\\s*(${NUMBER})$`).exec(input))) {
    return { ok: true, value: { current: previous?.current ?? 0, max: toNumber(m[1]) } };
  }
  if ((m = new RegExp(`^([+-])\\s*(${NUMBER})$`).exec(input))) {
    const delta = toNumber(m[2]) * (m[1] === "-" ? -1 : 1);
    return { ok: true, value: adjustBar(previous, delta) };
  }
  if (new RegExp(`^${NUMBER}$`).test(input)) {
    const current = toNumber(input);
    return { ok: true, value: { current, max: previous ? previous.max : current } };
  }
  return { ok: false, error: "Type something like 22/30, a new number, or +5 / -5." };
}
