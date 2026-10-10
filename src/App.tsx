import { useCallback, useEffect, useMemo, useState } from "react";
import { ItemView } from "./components/item/ItemView";
import { CommandPalette } from "./components/palette/CommandPalette";
import { QuickToolsPanel } from "./components/quick/QuickToolsPanel";
import { StatusBar } from "./components/StatusBar";
import { registry } from "./registry";
import { CurrentProjectProvider, useCurrentProject } from "./state/CurrentProject";
import { NavigationProvider } from "./state/Navigation";
import { RenameReviewProvider } from "./state/renameReview";
import { rollLog } from "./state/rollLog";
import "./App.css";

/** The app shell: navigation is built from whatever tools modules have registered. */
function Shell() {
  const tools = registry.getTools();
  const [activeId, setActiveId] = useState(tools[0]?.id);
  const active = tools.find((t) => t.id === activeId) ?? tools[0];
  const { project } = useCurrentProject();

  // Items opened one after another (via links); Back pops one. Empty = showing the tool.
  const [itemStack, setItemStack] = useState<string[]>([]);
  const currentItemId = itemStack[itemStack.length - 1];

  const openItem = useCallback(
    (id: string) => setItemStack((stack) => (stack[stack.length - 1] === id ? stack : [...stack, id])),
    [],
  );
  const navigation = useMemo(() => ({ openItem }), [openItem]);

  // Items belong to a project, so switching projects closes any open item.
  const projectId = project?.id;
  useEffect(() => {
    setItemStack([]);
    // Rolls can be saved into a project, so each project starts with a fresh log.
    rollLog.clear();
  }, [projectId]);

  function openTool(id: string) {
    setItemStack([]);
    setActiveId(id);
  }

  // Ctrl+K (Cmd+K on a Mac) opens or closes the command palette; Ctrl+J the quick tools panel.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const openQuickTools = useCallback(() => setQuickOpen(true), []);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setQuickOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <NavigationProvider value={navigation}>
      <div className="shell">
        <StatusBar
          onChangeProject={() =>
            registry.getCommand("core.open-projects")?.run({ openTool, openQuickTools })
          }
          onOpenPalette={() => setPaletteOpen(true)}
          onToggleQuickTools={() => setQuickOpen((open) => !open)}
        />
        {paletteOpen && (
          <CommandPalette
            onClose={() => setPaletteOpen(false)}
            onOpenTool={openTool}
            onOpenQuickTools={openQuickTools}
          />
        )}
        {quickOpen && <QuickToolsPanel onClose={() => setQuickOpen(false)} />}
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
    <CurrentProjectProvider>
      <RenameReviewProvider>
        <Shell />
      </RenameReviewProvider>
    </CurrentProjectProvider>
  );
}

export default App;
