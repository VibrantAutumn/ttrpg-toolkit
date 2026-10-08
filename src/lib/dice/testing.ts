import type { Rng } from "./rng";

/**
 * A fake random source for tests: hands back the listed values in order, so a
 * test can say exactly what each die "rolled". It also checks that every value
 * fits the range the roller asked for (so a wrong die size is caught), and
 * fails if the roller asks for more dice than the test expected.
 */
export function scripted(...values: number[]): Rng & { remaining(): number } {
  let next = 0;
  return {
    int(min: number, max: number): number {
      if (next >= values.length) {
        throw new Error(`scripted rng ran out after ${values.length} value(s)`);
      }
      const value = values[next++];
      if (value < min || value > max) {
        throw new Error(`scripted value ${value} is outside the asked range ${min}..${max}`);
      }
      return value;
    },
    remaining: () => values.length - next,
  };
}
