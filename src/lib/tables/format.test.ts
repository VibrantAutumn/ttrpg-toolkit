import { describe, expect, it } from "vitest";
import { formatTableResult } from "./format";

describe("formatTableResult", () => {
  it("writes the table's name, an arrow and the result", () => {
    expect(formatTableResult("Rumors", "A dragon sleeps under the mill")).toBe(
      "Rumors → A dragon sleeps under the mill",
    );
  });

  it("keeps a result that has several lines as it is", () => {
    expect(formatTableResult("Hooks", "Line one\nLine two")).toBe("Hooks → Line one\nLine two");
  });
});
