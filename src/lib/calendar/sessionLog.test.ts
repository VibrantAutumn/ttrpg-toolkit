import { describe, expect, it } from "vitest";
import { markdownToDoc, docToMarkdown } from "../documents/markdown";
import { appendEntry, logEntry } from "./sessionLog";
import { gregorian } from "./testing";
import { partsToDay } from "./math";

const g = gregorian();
const at = { day: partsToDay(g, { year: 2024, month: 2, day: 5 })!, minute: 9 * 60 + 5 };

describe("session log entries", () => {
  it("writes the moment, a dash and the text", () => {
    expect(logEntry(g, at, "  The party meets a stranger.  ")).toBe("**5 March 2024 CE, 09:05** — The party meets a stranger.");
    expect(logEntry(g, at, "Won the fight.", "Goblin ambush")).toBe("**5 March 2024 CE, 09:05 · Goblin ambush** — Won the fight.");
  });
  it("keeps line breaks", () => {
    expect(logEntry(g, at, "Round 3\nGoblin 1 is down")).toContain("Round 3\\\nGoblin 1 is down");
  });
  it("appends after existing text with one blank line, and starts an empty log cleanly", () => {
    expect(appendEntry("", "A")).toBe("A\n");
    expect(appendEntry("First\n\n\n", "A")).toBe("First\n\nA\n");
    expect(appendEntry(appendEntry("", "A"), "B")).toBe("A\n\nB\n");
  });
  it("what it writes is stable in the page editor (reading then writing changes nothing)", () => {
    const body = appendEntry(appendEntry("", logEntry(g, at, "Round 3\nGoblin 1 is down", "Ambush")), logEntry(g, at, "Rested."));
    const again = docToMarkdown(markdownToDoc(body));
    expect(again.trim()).toBe(body.trim());
  });
});
