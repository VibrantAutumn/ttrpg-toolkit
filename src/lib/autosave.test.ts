import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, type SaveStatus } from "./autosave";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createAutosaver", () => {
  it("collapses rapid changes into one save of the latest text", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutosaver({ save, delayMs: 800 });
    saver.change("a");
    saver.change("ab");
    saver.change("abc");
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abc");
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("restarts the wait on every change", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutosaver({ save, delayMs: 100 });
    saver.change("a");
    await vi.advanceTimersByTimeAsync(80);
    saver.change("ab");
    await vi.advanceTimersByTimeAsync(80);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(save).toHaveBeenCalledWith("ab");
  });

  it("flush saves immediately and the timer does not save again", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutosaver({ save, delayMs: 800 });
    saver.change("text");
    expect(saver.hasUnsaved()).toBe(true);
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush with nothing to save does nothing", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutosaver({ save, delayMs: 800 });
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("runs saves one at a time and in order", async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    const save = vi.fn(async (text: string) => {
      order.push(`start ${text}`);
      if (text === "first") await new Promise<void>((resolve) => (releaseFirst = resolve));
      order.push(`end ${text}`);
    });
    const saver = createAutosaver({ save, delayMs: 800 });
    saver.change("first");
    const firstFlush = saver.flush();
    saver.change("second");
    const secondFlush = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["start first"]); // second waits for the first
    releaseFirst();
    await Promise.all([firstFlush, secondFlush]);
    expect(order).toEqual(["start first", "end first", "start second", "end second"]);
  });

  it("keeps the text after a failed save and retries on the next flush", async () => {
    const save = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const statuses: SaveStatus[] = [];
    const saver = createAutosaver({ save, delayMs: 800, onStatus: (s) => statuses.push(s) });
    saver.change("precious");
    await saver.flush(); // does not throw
    expect(statuses[statuses.length - 1]).toBe("error");
    expect(saver.hasUnsaved()).toBe(true);

    await saver.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("precious");
    expect(statuses[statuses.length - 1]).toBe("saved");
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("a newer edit wins over text kept from a failed save", async () => {
    const save = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("nope"))
      .mockResolvedValue(undefined);
    const saver = createAutosaver({ save, delayMs: 800 });
    saver.change("old");
    await saver.flush();
    saver.change("new");
    await saver.flush();
    expect(save).toHaveBeenLastCalledWith("new");
  });

  it("reports dirty, saving, then saved", async () => {
    const statuses: SaveStatus[] = [];
    const saver = createAutosaver({
      save: async () => {},
      delayMs: 100,
      onStatus: (s) => statuses.push(s),
    });
    saver.change("x");
    await vi.advanceTimersByTimeAsync(100);
    expect(statuses).toEqual(["dirty", "saving", "saved"]);
  });

  it("stays dirty if more edits arrive while a save is running", async () => {
    let release: () => void = () => {};
    const save = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const statuses: SaveStatus[] = [];
    const saver = createAutosaver({ save, delayMs: 100, onStatus: (s) => statuses.push(s) });
    saver.change("one");
    await vi.advanceTimersByTimeAsync(100); // save #1 starts and hangs
    saver.change("two");
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses[statuses.length - 1]).toBe("dirty");
    expect(saver.hasUnsaved()).toBe(true);
  });
});
