/**
 * Source of random whole numbers for dice. Everything that rolls takes one of
 * these instead of calling Math.random, so tests can script the dice and a
 * result can be reproduced from its seed.
 */
export interface Rng {
  /** A whole number from min to max, both included. */
  int(min: number, max: number): number;
}

export interface SeededRng extends Rng {
  readonly seed: number;
}

/**
 * A small seeded generator (mulberry32). The same seed always gives the same
 * sequence. It is not cryptographically secure, which is fine for dice.
 */
export function createRng(seed: number): SeededRng {
  let state = seed >>> 0;

  function nextFloat(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    seed,
    int(min: number, max: number): number {
      if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
        throw new RangeError(`rng.int needs whole numbers with min <= max, got ${min}..${max}`);
      }
      return min + Math.floor(nextFloat() * (max - min + 1));
    },
  };
}

/** A fresh seed for a new roll (the only place that touches Math.random). */
export function newSeed(): number {
  return Math.floor(Math.random() * 4294967296);
}
