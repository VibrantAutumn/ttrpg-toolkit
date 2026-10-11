/**
 * Opens the player display: the app's own page with `?display=1`, in a second window. In the desktop app that is a Tauri
 * window (the display shows only what `lib/encounters/displayChannel.ts` hands it); in a plain browser (the dev
 * preview) it is a pop-up. Asking again when it is already open brings it to the front.
 */
const LABEL = "player-display";

export async function openDisplayWindow(): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(LABEL);
    if (existing) {
      await existing.setFocus();
      return;
    }
    const created = new WebviewWindow(LABEL, { url: "index.html?display=1", title: "Player display", width: 960, height: 600 });
    await new Promise<void>((resolve, reject) => {
      void created.once("tauri://created", () => resolve());
      void created.once("tauri://error", (event) => reject(new Error(String(event.payload))));
    });
    return;
  }
  const opened = window.open(`${window.location.pathname}?display=1`, LABEL, "width=960,height=600");
  if (!opened) throw new Error("The browser blocked the new window. Allow pop-ups for this page and try again.");
}
