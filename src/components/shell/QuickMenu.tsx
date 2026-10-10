import { registry } from "../../registry";

/**
 * The floating quick menu at the bottom right: one round icon button per registered quick tool
 * (dice, cards, tables); each opens (or closes) that tool's floating panel over the current
 * screen. It is built from `registry.getWidgets()`, so a module's widget shows up by itself.
 */
export function QuickMenu({ openId, onToggle }: { openId: string | null; onToggle: (widgetId: string) => void }) {
  const widgets = registry.getWidgets();
  if (widgets.length === 0) return null;
  return (
    <div className={openId ? "quick-menu panel-open" : "quick-menu"} role="group" aria-label="Quick tools">
      {widgets.map((w) => (
        <button
          key={w.id}
          type="button"
          className={w.id === openId ? "quick-fab active" : "quick-fab"}
          aria-label={w.label}
          title={w.label}
          aria-pressed={w.id === openId}
          onClick={() => onToggle(w.id)}
        >
          <span aria-hidden="true">{w.icon}</span>
        </button>
      ))}
    </div>
  );
}
