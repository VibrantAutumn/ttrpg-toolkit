import type { RefObject } from "react";
import { registry } from "../../registry";
import type { AppContext, ToolDefinition } from "../../registry/types";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SidebarSearch } from "./SidebarSearch";

/**
 * The fixed left sidebar (a slide-in drawer on narrow screens): the project switcher, the search
 * bar, a row of tool icons (Home, Cards, Dice, Tables...), whatever a tool draws under the row (the
 * pages tree and Templates), and a footer of icons (Trash, Settings). The quick tools float at the
 * bottom right instead (`QuickMenu`). Everything is read from the registry, so a new module shows
 * up here by itself; a tool's `placement` says whether its icon is in the row or the footer.
 */
export function Sidebar({
  activeToolId,
  searchRef,
  context,
  onOpenTool,
  onNavigated,
}: {
  activeToolId: string | undefined;
  searchRef: RefObject<HTMLInputElement | null>;
  context: AppContext;
  onOpenTool: (toolId: string) => void;
  /** Called after anything that moves you somewhere, so a drawer can close itself. */
  onNavigated: () => void;
}) {
  const tools = registry.getTools().filter((t) => t.inSidebar !== false);
  const top = tools.filter((t) => t.placement !== "bottom");
  const bottom = tools.filter((t) => t.placement === "bottom");

  const icon = (t: ToolDefinition) => (
    <button
      key={t.id}
      type="button"
      className={t.id === activeToolId ? "sidebar-icon active" : "sidebar-icon"}
      aria-label={t.label}
      title={t.label}
      aria-current={t.id === activeToolId ? "page" : undefined}
      onClick={() => {
        onOpenTool(t.id);
        onNavigated();
      }}
    >
      <span aria-hidden="true">{t.icon}</span>
    </button>
  );

  return (
    <nav className="sidebar-inner" aria-label="Main">
      <ProjectSwitcher onManage={() => onOpenTool("projects")} onChosen={onNavigated} />
      <SidebarSearch ref={searchRef} context={context} onChosen={onNavigated} />

      <div className="sidebar-icons" role="group" aria-label="Tools">
        {top.map(icon)}
      </div>

      {top.map((t) => {
        const Extra = t.sidebar;
        return Extra ? <Extra key={t.id} /> : null;
      })}

      <div className="sidebar-footer" role="group" aria-label="More">
        {bottom.map(icon)}
      </div>
    </nav>
  );
}
