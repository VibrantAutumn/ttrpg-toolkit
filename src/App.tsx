import { useCallback, useEffect, useMemo, useState } from "react";
import { ItemView } from "./components/item/ItemView";
import { StatusBar } from "./components/StatusBar";
import { registry } from "./registry";
import { CurrentCampaignProvider, useCurrentCampaign } from "./state/CurrentCampaign";
import { NavigationProvider } from "./state/Navigation";
import "./App.css";

/** The app shell: navigation is built from whatever tools modules have registered. */
function Shell() {
  const tools = registry.getTools();
  const [activeId, setActiveId] = useState(tools[0]?.id);
  const active = tools.find((t) => t.id === activeId) ?? tools[0];
  const { campaign } = useCurrentCampaign();

  // Items opened one after another (via links); Back pops one. Empty = showing the tool.
  const [itemStack, setItemStack] = useState<string[]>([]);
  const currentItemId = itemStack[itemStack.length - 1];

  const openItem = useCallback(
    (id: string) => setItemStack((stack) => (stack[stack.length - 1] === id ? stack : [...stack, id])),
    [],
  );
  const navigation = useMemo(() => ({ openItem }), [openItem]);

  // Items belong to a campaign, so switching campaigns closes any open item.
  const campaignId = campaign?.id;
  useEffect(() => {
    setItemStack([]);
  }, [campaignId]);

  function openTool(id: string) {
    setItemStack([]);
    setActiveId(id);
  }

  return (
    <NavigationProvider value={navigation}>
      <div className="shell">
        <StatusBar
          onChangeCampaign={() =>
            registry.getCommand("core.open-campaigns")?.run({ openTool })
          }
        />
        <nav className="nav" aria-label="Tools">
          {tools.map((t) => (
            <button
              key={t.id}
              className={t.id === active?.id ? "active" : undefined}
              aria-current={t.id === active?.id ? "page" : undefined}
              onClick={() => openTool(t.id)}
            >
              <span aria-hidden="true">{t.icon}</span> {t.label}
            </button>
          ))}
        </nav>
        <main className="app">
          {/* The tool stays mounted (just hidden) so its folder, search and so on are still there on Back. */}
          <div hidden={currentItemId !== undefined}>
            {active ? <active.component /> : <p>No tools are registered.</p>}
          </div>
          {currentItemId !== undefined && (
            <ItemView
              key={currentItemId}
              itemId={currentItemId}
              onBack={() => setItemStack((stack) => stack.slice(0, -1))}
            />
          )}
        </main>
      </div>
    </NavigationProvider>
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
