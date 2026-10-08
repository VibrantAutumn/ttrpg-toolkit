/**
 * Dice notation parser. Turns text like "4d6r1!kh3+2" into a structure that
 * roll.ts can roll. Pure logic: no randomness here.
 *
 * Grammar (spaces and letter case are ignored):
 *   formula  := ["+"|"-"] term (("+"|"-") term)*
 *   term     := number | [count] "d" (sides | "F") modifiers
 *   modifiers, in this order, each at most once:
 *     reroll   r[cmp]N | ro[cmp]N     (r = until it stops matching, ro = once)
 *     explode  ![cmp][N]              (default: the highest face)
 *     keep     kh[N] kl[N] k[N] dh[N] dl[N]   or   adv / dis (a single die)
 *     target   cmp N                  (makes it a pool: counts successes)
 *   cmp := = | > | >= | < | <=
 */

export const MAX_DICE = 100;
export const MAX_SIDES = 100;
/** Largest plain number accepted (keeps arithmetic safely small). */
const MAX_NUMBER_DIGITS = 9;

export type CompareOp = "=" | ">" | ">=" | "<" | "<=";

export interface Compare {
  op: CompareOp;
  value: number;
}

export type Die = { type: "numeric"; sides: number } | { type: "fate" };

export interface DiceTerm {
  kind: "dice";
  sign: 1 | -1;
  count: number;
  die: Die;
  reroll?: Compare & { once: boolean };
  explode?: Compare;
  keep?: { mode: "keep" | "drop"; end: "highest" | "lowest"; count: number };
  target?: Compare;
}

export interface ConstantTerm {
  kind: "constant";
  sign: 1 | -1;
  value: number;
}

export type Term = DiceTerm | ConstantTerm;

export interface DiceExpression {
  /** The notation with spaces removed and lowercased. */
  notation: string;
  terms: Term[];
}

export interface ParseError {
  message: string;
  /** Index in the original text where the problem is. */
  position: number;
}

export type ParseResult = { ok: true; expression: DiceExpression } | { ok: false; error: ParseError };

class NotationError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

/** Modifier order: a modifier may only follow ones with a lower stage. */
const STAGE = { reroll: 1, explode: 2, keep: 3, target: 4 } as const;

export function parseDice(input: string): ParseResult {
  try {
    return { ok: true, expression: new Parser(input).parse() };
  } catch (e) {
    if (e instanceof NotationError) {
      return { ok: false, error: { message: e.message, position: e.position } };
    }
    throw e;
  }
}

function matches(compare: Compare, value: number): boolean {
  switch (compare.op) {
    case "=":
      return value === compare.value;
    case ">":
      return value > compare.value;
    case ">=":
      return value >= compare.value;
    case "<":
      return value < compare.value;
    case "<=":
      return value <= compare.value;
  }
}

class Parser {
  private i = 0;
  private totalDice = 0;

  constructor(private readonly src: string) {}

  parse(): DiceExpression {
    this.skipSpaces();
    if (this.atEnd()) throw new NotationError("Nothing to roll: the formula is empty", 0);

    const terms: Term[] = [];
    let sign: 1 | -1 = 1;
    if (this.peek() === "+" || this.peek() === "-") sign = this.takeSign();
    terms.push(this.parseTerm(sign));

    for (;;) {
      this.skipSpaces();
      if (this.atEnd()) break;
      const c = this.peek();
      if (c !== "+" && c !== "-") {
        throw new NotationError(`Unexpected "${this.src[this.i]}"`, this.i);
      }
      terms.push(this.parseTerm(this.takeSign()));
    }

    return { notation: this.src.replace(/\s+/g, "").toLowerCase(), terms };
  }

  // --- terms ---

  private parseTerm(sign: 1 | -1): Term {
    this.skipSpaces();
    let count: number | undefined;
    if (isDigit(this.peek())) {
      const start = this.i;
      count = this.readNumber();
      if (this.peek() !== "d") {
        return { kind: "constant", sign, value: count };
      }
      if (count < 1) throw new NotationError("A dice group needs at least 1 die", start);
      if (count > MAX_DICE) throw new NotationError(`At most ${MAX_DICE} dice per roll`, start);
    }
    if (this.peek() !== "d") {
      throw new NotationError("Expected a number or dice such as 2d6", this.i);
    }
    this.i++; // the "d"
    const die = this.parseDie();
    const term: DiceTerm = { kind: "dice", sign, count: count ?? 1, die };
    this.parseModifiers(term);

    this.totalDice += term.count;
    if (this.totalDice > MAX_DICE) {
      throw new NotationError(`At most ${MAX_DICE} dice per roll`, this.i);
    }
    return term;
  }

  private parseDie(): Die {
    if (this.peek() === "f") {
      this.i++;
      return { type: "fate" };
    }
    if (!isDigit(this.peek())) {
      throw new NotationError("Expected the number of faces (d6) or F after the d", this.i);
    }
    const start = this.i;
    const sides = this.readNumber();
    if (sides < 1) throw new NotationError("A die needs at least 1 face", start);
    if (sides > MAX_SIDES) throw new NotationError(`At most ${MAX_SIDES} faces per die`, start);
    return { type: "numeric", sides };
  }

  // --- modifiers ---

  private parseModifiers(term: DiceTerm): void {
    let stage = 0;
    const enter = (next: number, at: number): void => {
      if (next <= stage) {
        throw new NotationError(
          "Modifiers go in this order, each once: reroll, explode, keep/drop, target",
          at,
        );
      }
      stage = next;
    };
    const fateCheck = (what: string, at: number): void => {
      if (term.die.type === "fate") throw new NotationError(`Fate dice can't use ${what}`, at);
    };

    for (;;) {
      this.skipSpaces();
      const at = this.i;
      const c = this.peek();

      if (c === "r") {
        enter(STAGE.reroll, at);
        fateCheck("rerolls", at);
        this.i++;
        let once = false;
        if (this.peek() === "o") {
          once = true;
          this.i++;
        }
        const cmp = this.parseCompare(true);
        if (cmp === undefined) throw new NotationError("A reroll needs a value, like r1 or r<=2", this.i);
        const sides = (term.die as { sides: number }).sides;
        if (!once && allFacesMatch(cmp, sides)) {
          throw new NotationError("That reroll matches every face, so it could never finish", at);
        }
        term.reroll = { ...cmp, once };
      } else if (c === "!") {
        enter(STAGE.explode, at);
        fateCheck("exploding", at);
        this.i++;
        const sides = (term.die as { sides: number }).sides;
        term.explode = this.parseCompare(true) ?? { op: "=", value: sides };
      } else if (c === "k") {
        enter(STAGE.keep, at);
        this.i++;
        let end: "highest" | "lowest" = "highest";
        if (this.peek() === "h" || this.peek() === "l") {
          end = this.peek() === "h" ? "highest" : "lowest";
          this.i++;
        }
        term.keep = { mode: "keep", end, count: this.parseOptionalCount() };
      } else if (c === "d" && (this.peek(1) === "h" || this.peek(1) === "l")) {
        enter(STAGE.keep, at);
        const end = this.peek(1) === "h" ? "highest" : "lowest";
        this.i += 2;
        term.keep = { mode: "drop", end, count: this.parseOptionalCount() };
      } else if (this.lookingAt("adv") || this.lookingAt("dis")) {
        enter(STAGE.keep, at);
        const advantage = this.lookingAt("adv");
        this.i += 3;
        if (term.die.type === "fate" || term.count !== 1) {
          throw new NotationError("Advantage and disadvantage only work on a single die, like d20 adv", at);
        }
        term.count = 2;
        term.keep = { mode: "keep", end: advantage ? "highest" : "lowest", count: 1 };
      } else if (c === "=" || c === ">" || c === "<") {
        enter(STAGE.target, at);
        fateCheck("a success target", at);
        const cmp = this.parseCompare(false);
        if (cmp === undefined) throw new NotationError("A target needs a value, like >=8", this.i);
        term.target = cmp;
      } else {
        break;
      }
    }

    if (term.keep) {
      const { mode, count } = term.keep;
      if (count < 1) throw new NotationError(`You must ${mode} at least 1 die`, this.i);
      if (mode === "keep" && count > term.count) {
        throw new NotationError(`Can't keep ${count} dice out of ${term.count}`, this.i);
      }
      if (mode === "drop" && count >= term.count) {
        throw new NotationError(`Can't drop ${count} of ${term.count} dice: none would be left`, this.i);
      }
    }
  }

  /**
   * Reads an optional comparison and a number. With `bareOk`, a number alone
   * means "equals". Returns undefined if nothing is there to read.
   */
  private parseCompare(bareOk: boolean): Compare | undefined {
    let op: CompareOp | undefined;
    const c = this.peek();
    const next = this.peek(1);
    if (c === ">" || c === "<") {
      if (next === "=") {
        op = c === ">" ? ">=" : "<=";
        this.i += 2;
      } else {
        op = c;
        this.i += 1;
      }
    } else if (c === "=") {
      op = "=";
      this.i += 1;
    } else if (bareOk && isDigit(c)) {
      op = "=";
    }
    if (op === undefined) return undefined;
    if (!isDigit(this.peek())) {
      throw new NotationError("Expected a number after the comparison", this.i);
    }
    return { op, value: this.readNumber() };
  }

  /** A count after k/dh/dl; one if missing. */
  private parseOptionalCount(): number {
    return isDigit(this.peek()) ? this.readNumber() : 1;
  }

  // --- low-level reading ---

  private takeSign(): 1 | -1 {
    const sign = this.peek() === "-" ? -1 : 1;
    this.i++;
    return sign;
  }

  private readNumber(): number {
    const start = this.i;
    while (isDigit(this.peek())) this.i++;
    if (this.i - start > MAX_NUMBER_DIGITS) {
      throw new NotationError("That number is too large", start);
    }
    return parseInt(this.src.slice(start, this.i), 10);
  }

  private skipSpaces(): void {
    while (/\s/.test(this.src[this.i] ?? "x")) this.i++;
  }

  private atEnd(): boolean {
    return this.i >= this.src.length;
  }

  /** The (lowercased) character `ahead` places on, or "" past the end. */
  private peek(ahead = 0): string {
    return (this.src[this.i + ahead] ?? "").toLowerCase();
  }

  private lookingAt(word: string): boolean {
    return this.src.slice(this.i, this.i + word.length).toLowerCase() === word;
  }
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9" && c.length === 1;
}

function allFacesMatch(compare: Compare, sides: number): boolean {
  for (let face = 1; face <= sides; face++) {
    if (!matches(compare, face)) return false;
  }
  return true;
}

export { matches as matchesCompare };
