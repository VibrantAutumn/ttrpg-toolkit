import { describe, expect, it } from "vitest";
import { parseWeather, pickWeatherTable, weatherSummary, weatherToJson } from "./weather";

describe("weather records", () => {
  it("round trips", () => {
    const w = { text: "Light rain for 3 hours", table: "Temperate weather", season: "Spring", manual: false };
    expect(parseWeather(weatherToJson(w))).toEqual(w);
  });
  it("reads garbage as nothing and repairs what it can", () => {
    expect(parseWeather("nope")).toBeNull();
    expect(parseWeather("[]")).toBeNull();
    expect(parseWeather('{"text":5}')).toBeNull();
    expect(parseWeather('{"text":"Fog","table":7}')).toEqual({ text: "Fog", table: null, season: null, manual: false });
  });
  it("keeps the text short", () => {
    expect(parseWeather(weatherToJson({ text: "x".repeat(1000), table: null, season: null, manual: true }))!.text.length).toBe(300);
  });
});

describe("pickWeatherTable", () => {
  const base = { name: "Temperate weather" };
  const winter = { name: "temperate weather (winter)" };
  const tables = [base, winter, { name: "Desert weather" }];
  it("prefers the season's variant, ignoring case", () => {
    expect(pickWeatherTable(tables, base, "Winter")).toBe(winter);
  });
  it("falls back to the base table", () => {
    expect(pickWeatherTable(tables, base, "Summer")).toBe(base);
    expect(pickWeatherTable(tables, base, null)).toBe(base);
  });
});

describe("weatherSummary", () => {
  it("uses the first sentence and cuts long ones", () => {
    expect(weatherSummary({ text: "A blizzard. Visibility is nil.", table: null, season: null, manual: false })).toBe("A blizzard");
    expect(weatherSummary({ text: "x".repeat(100), table: null, season: null, manual: false }, 10)).toBe("xxxxxxxxx…");
  });
});
