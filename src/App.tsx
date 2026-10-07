import { useState } from "react";
import { StatusBar } from "./components/StatusBar";
import { registry } from "./registry";
import { CurrentCampaignProvider } from "./state/CurrentCampaign";
import "./App.css";

/** The app shell: navigation is built from whatever tools modules have registered. */
function Shell() {
  const tools = registry.getTools();
  const [activeId, setActiveId] = useState(tools[0]?.id);
  const active = tools.find((t) => t.id === activeId) ?? tools[0];

  return (
    <div className="shell">
      <StatusBar
        onChangeCampaign={() =>
          registry.getCommand("core.open-campaigns")?.run({ openTool: setActiveId })
        }
      />
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

function App() {
  return (
    <CurrentCampaignProvider>
      <Shell />
    </CurrentCampaignProvider>
  );
}

export default App;
