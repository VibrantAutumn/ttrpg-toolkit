import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe("bytesToBase64", () => {
  it("matches known standard base64 values", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
    expect(bytesToBase64(ascii("hello"))).toBe("aGVsbG8=");
    expect(bytesToBase64(ascii("ab"))).toBe("YWI=");
    expect(bytesToBase64(ascii("abc"))).toBe("YWJj");
    // The two characters that differ from URL-safe base64.
    expect(bytesToBase64(bytes(0xfb, 0xff))).toBe("+/8=");
    // The start of a zip file ("PK\x03\x04"), as a pack begins.
    expect(bytesToBase64(bytes(0x50, 0x4b, 0x03, 0x04))).toBe("UEsDBA==");
  });
});

describe("base64ToBytes", () => {
  it("decodes known values", () => {
    expect(Array.from(base64ToBytes(""))).toEqual([]);
    expect(Array.from(base64ToBytes("aGVsbG8="))).toEqual(Array.from(ascii("hello")));
    expect(Array.from(base64ToBytes("+/8="))).toEqual([0xfb, 0xff]);
  });

  it("rejects text that is not base64", () => {
    expect(() => base64ToBytes("not base64 !!!")).toThrow();
  });
});

describe("round trips", () => {
  it("preserves every possible byte value", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(base64ToBytes(bytesToBase64(all)))).toEqual(Array.from(all));
  });

  it("works across the chunk boundary and for large files", () => {
    // 0x8000 = 32768 is the chunk size; try sizes just below, at and above it.
    for (const size of [1, 2, 3, 32767, 32768, 32769, 65536, 100_001, 2_000_000]) {
      const data = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) % 256);
      const back = base64ToBytes(bytesToBase64(data));
      expect(back.length).toBe(size);
      expect(back.every((b, i) => b === data[i])).toBe(true);
    }
  });
});
