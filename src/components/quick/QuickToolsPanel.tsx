import { useEffect, useRef, useState } from "react";
import { loadCollapsed, saveCollapsed, toggleCollapsed } from "../../lib/quickPanel";
import { registry } from "../../registry";
import { useRollLog } from "../../state/rollLog";
import { LogEntryView } from "../results/LogEntryView";

/** The browser's storage if it is available (it can be blocked), else nothing. */
function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The quick tools panel: small tools (a roller, a draw box, your games in play)
 * kept at hand over whichever screen you are on, so a roll or a draw never costs
 * you your place. It is built from whatever widgets modules have registered, and
 * shows the newest result of any kind at the top. Which widgets are collapsed is
 * remembered on this device. Esc or the close button puts it away.
 */
export function QuickToolsPanel({ onClose }: { onClose: () => void }) {
  const widgets = registry.getWidgets();
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(storage()));
  const log = useRollLog();
  const latest = log[0];
  const panel = useRef<HTMLElement>(null);

  // Move focus into the panel when it opens, so Esc works straight away.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = toggleCollapsed(current, id);
      saveCollapsed(storage(), next);
      return next;
    });
  }

  return (
    <aside
      ref={panel}
      className="quick-panel"
      aria-label="Quick tools"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="quick-panel-head">
        <strong>⚡ Quick tools</strong>
        <button onClick={onClose} aria-label="Close quick tools">
          ✕
        </button>
      </div>

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

      {widgets.length === 0 && <p className="empty">No quick tools are available.</p>}
      {widgets.map((widget) => {
        const open = !collapsed.has(widget.id);
        const Widget = widget.component;
        return (
          <section key={widget.id} className="quick-widget">
            <h2>
              <button className="quick-widget-toggle" aria-expanded={open} onClick={() => toggle(widget.id)}>
                <span aria-hidden="true">{open ? "▾" : "▸"}</span> <span aria-hidden="true">{widget.icon}</span>{" "}
                {widget.label}
              </button>
            </h2>
            {open && (
              <div className="quick-widget-body">
                <Widget />
              </div>
            )}
          </section>
        );
      })}
    </aside>
  );
}
