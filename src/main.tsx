import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

function start() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// Dev only: in a plain browser (no Tauri window) a pretend backend lets screens open for a layout
// check. It is never part of the production build.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  import("./dev/mockBackend").then((m) => {
    m.installMockBackend();
    start();
  });
} else {
  start();
}
