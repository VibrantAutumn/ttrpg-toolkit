import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ItemView } from "./components/item/ItemView";
import { QuickToolsPanel } from "./components/quick/QuickToolsPanel";
import { QuickMenu } from "./components/shell/QuickMenu";
import { StatusBar } from "./components/shell/StatusBar";
import { Sidebar } from "./components/shell/Sidebar";
import { registry } from "./registry";
import { CurrentProjectProvider, useCurrentProject } from "./state/CurrentProject";
import { NavigationProvider } from "./state/Navigation";
import { RenameReviewProvider } from "./state/renameReview";
import { rollLog } from "./state/rollLog";
import { TimeProvider } from "./state/timeState";
import "./App.css";

/**
 * The app shell: a fixed sidebar (a slide-in drawer on narrow screens) built from whatever tools
 * and quick tools modules have registered, and the main area beside it.
 */
function Shell() {
  const tools = registry.getTools();
  const [activeId, setActiveId] = useState(registry.getTools().find((t) => t.inSidebar !== false)?.id ?? tools[0]?.id);
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

  // The drawer (narrow screens only; on wide screens the sidebar is always there).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // One quick tool at a time floats over the screen; the sidebar button for it toggles it.
  const [quickId, setQuickId] = useState<string | null>(null);
  const lastQuickId = useRef<string | null>(null);
  const toggleQuick = useCallback((id: string) => {
    setQuickId((current) => (current === id ? null : id));
    lastQuickId.current = id;
    setDrawerOpen(false); // on a phone the floating tool should not hide behind the drawer
  }, []);
  const openQuickTools = useCallback(() => {
    const id = lastQuickId.current ?? registry.getWidgets()[0]?.id ?? null;
    lastQuickId.current = id;
    setQuickId(id);
  }, []);

  // Ctrl+K (Cmd+K on a Mac) goes to the search bar; Ctrl+J shows or hides the last quick tool.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDrawerOpen(true);
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setQuickId((open) => {
          if (open) return null;
          const id = lastQuickId.current ?? registry.getWidgets()[0]?.id ?? null;
          lastQuickId.current = id;
          return id;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const context = useMemo(() => ({ openTool, openQuickTools }), [openQuickTools]);

  return (
    <NavigationProvider value={navigation}>
      <div className="shell">
        <header className="mobile-bar">
          <button type="button" aria-label="Open the menu" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
            ☰
          </button>
          <span className="mobile-title">{project?.name ?? "No project open"}</span>
        </header>
        {drawerOpen && <div className="drawer-backdrop" onClick={closeDrawer} />}
        <aside className={drawerOpen ? "sidebar open" : "sidebar"}>
          <Sidebar
            activeToolId={active?.id}
            searchRef={searchRef}
            context={context}
            onOpenTool={openTool}
            onNavigated={closeDrawer}
          />
        </aside>
        {quickId && <QuickToolsPanel widgetId={quickId} onClose={() => setQuickId(null)} />}
        <QuickMenu openId={quickId} onToggle={toggleQuick} />
        <main className="app">
          <StatusBar />
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
        <TimeProvider>
          <Shell />
        </TimeProvider>
      </RenameReviewProvider>
    </CurrentProjectProvider>
  );
}

export default App;
