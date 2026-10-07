import { useState } from "react";
import { registry } from "./registry";
import "./App.css";

/** The app shell: navigation is built from whatever tools modules have registered. */
function App() {
  const tools = registry.getTools();
  const [activeId, setActiveId] = useState(tools[0]?.id);
  const active = tools.find((t) => t.id === activeId) ?? tools[0];

  return (
    <div className="shell">
      <nav className="nav" aria-label="Tools">
        {tools.map((t) => (
          <button
            key={t.id}
            className={t.id === active?.id ? "active" : undefined}
            aria-current={t.id === active?.id ? "page" : undefined}
            onClick={() => setActiveId(t.id)}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </nav>
      <main className="app">
        {active ? <active.component /> : <p>No tools are registered.</p>}
      </main>
    </div>
  );
}

export default App;
