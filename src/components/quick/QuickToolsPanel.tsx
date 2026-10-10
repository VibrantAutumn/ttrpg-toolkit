import { useEffect, useRef } from "react";
import { registry } from "../../registry";
import { useRollLog } from "../../state/rollLog";
import { LogEntryView } from "../results/LogEntryView";

/**
 * One quick tool in a floating panel: the widget a sidebar button picked (a roller, a draw box,
 * your games in play...), kept at hand over whichever screen you are on so a roll or a draw never
 * costs you your place, with the newest result of any kind at the top. It is a side panel on wide
 * screens and a bottom sheet on narrow ones. Esc or the close button puts it away.
 */
export function QuickToolsPanel({ widgetId, onClose }: { widgetId: string; onClose: () => void }) {
  const widget = registry.getWidgets().find((w) => w.id === widgetId);
  const log = useRollLog();
  const latest = log[0];
  const panel = useRef<HTMLElement>(null);

  // Move focus into the panel when it opens (or switches widget), so Esc works straight away.
  useEffect(() => {
    panel.current?.focus();
  }, [widgetId]);

  if (!widget) return null;
  const Widget = widget.component;

  return (
    <aside
      ref={panel}
      className="quick-panel"
      aria-label={widget.label}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="quick-panel-head">
        <strong>
          <span aria-hidden="true">{widget.icon}</span> {widget.label}
        </strong>
        <button onClick={onClose} aria-label={`Close ${widget.label}`}>
          ✕
        </button>
      </div>

      <section className="quick-widget">
        <div className="quick-widget-body">
          <Widget />
        </div>
      </section>

      <section className="quick-widget">
        <h2>Latest result</h2>
        {latest ? (
          <ul className="list">
            <LogEntryView key={latest.id} entry={latest} />
          </ul>
        ) : (
          <p className="empty">Nothing yet. Rolls and draws show up here.</p>
        )}
      </section>
    </aside>
  );
}
