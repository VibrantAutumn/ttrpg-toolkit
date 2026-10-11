import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PlayerDisplay } from "./modules/encounters/PlayerDisplay";

/** The player display is the same page opened with `?display=1` in its own window: it shows only what the GM shares. */
const isPlayerDisplay = new URLSearchParams(window.location.search).has("display");

function start() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>{isPlayerDisplay ? <PlayerDisplay /> : <App />}</React.StrictMode>,
  );
}

// Dev only: in a plain browser (no Tauri window) a pretend backend lets screens open for a layout
// check. It is never part of the production build.
if (!isPlayerDisplay && import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  import("./dev/mockBackend").then((m) => {
    m.installMockBackend();
    start();
  });
} else {
  start();
}
