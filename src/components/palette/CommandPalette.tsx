import { Fragment, useEffect, useState, type KeyboardEvent } from "react";
import { searchItems, type Item } from "../../api/library";
import { matchCommands } from "../../lib/palette";
import { registry } from "../../registry";
import type { CommandDefinition } from "../../registry/types";
import { useCurrentProject } from "../../state/CurrentProject";
import { useNavigation } from "../../state/Navigation";
import { itemIcon, libraryLabel } from "../item/itemDisplay";

type Result =
  | { kind: "command"; command: CommandDefinition }
  | { kind: "item"; item: Item };

/**
 * Type to run a command or jump to any item in the open project.
 * Up/Down + Enter on a keyboard, or tap a result. Esc or tapping outside closes it.
 */
export function CommandPalette({
  onClose,
  onOpenTool,
  onOpenQuickTools,
}: {
  onClose: () => void;
  onOpenTool: (toolId: string) => void;
  onOpenQuickTools: () => void;
}) {
  const { project } = useCurrentProject();
  const { openItem } = useNavigation();
  const projectId = project?.id ?? null;

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState(0);

  // Find matching items (after a short pause so we don't search on every keystroke).
  useEffect(() => {
    const text = query.trim();
    if (!projectId || !text) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchItems(projectId, text, null, 8)
        .then((found) => !cancelled && setItems(found))
        .catch(() => !cancelled && setItems([]));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, projectId]);

  useEffect(() => setSelected(0), [query]);

  const commands = matchCommands(registry.getCommands(), query);
  const results: Result[] = [
    ...commands.map((command) => ({ kind: "command" as const, command })),
    ...items.map((item) => ({ kind: "item" as const, item })),
  ];
  const active = Math.min(selected, results.length - 1);

  function choose(result: Result) {
    onClose();
    if (result.kind === "command") {
      result.command.run({ openTool: onOpenTool, openQuickTools: onOpenQuickTools });
    } else {
      openItem(result.item.id);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" && results.length > 0) {
      e.preventDefault();
      setSelected((active + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length > 0) {
      e.preventDefault();
      setSelected((active - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      choose(results[active]);
    }
  }

  function option(result: Result, index: number) {
    const key = result.kind === "command" ? `c:${result.command.id}` : `i:${result.item.id}`;
    return (
      <li
        key={key}
        id={`palette-option-${index}`}
        role="option"
        aria-selected={index === active}
        className={index === active ? "selected" : undefined}
        onMouseMove={() => setSelected(index)}
        onClick={() => choose(result)}
      >
        {result.kind === "command" ? (
          result.command.label
        ) : (
          <>
            {itemIcon(result.item)} {result.item.name}{" "}
            <small className="meta">{libraryLabel(result.item)}</small>
          </>
        )}
      </li>
    );
  }

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={projectId ? "Type a command or search items..." : "Type a command..."}
          aria-label="Command palette"
          aria-controls="palette-results"
          aria-activedescendant={results[active] ? `palette-option-${active}` : undefined}
          autoFocus
        />
        <ul id="palette-results" role="listbox" aria-label="Results">
          {commands.length > 0 && (
            <li role="presentation" className="group">
              Commands
            </li>
          )}
          {results.map((r, i) =>
            i === commands.length && r.kind === "item" ? (
              <Fragment key={`items-from-${r.item.id}`}>
                <li role="presentation" className="group">
                  Items
                </li>
                {option(r, i)}
              </Fragment>
            ) : (
              option(r, i)
            ),
          )}
        </ul>
        {results.length === 0 && query.trim() && (
          <p className="empty">Nothing matches “{query.trim()}”.</p>
        )}
        {!projectId && (
          <p className="empty">Open a project to search its items too.</p>
        )}
      </div>
    </div>
  );
}
