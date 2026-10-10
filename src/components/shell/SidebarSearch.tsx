import { forwardRef, Fragment, useEffect, useState, type KeyboardEvent } from "react";
import { searchItems, type Item } from "../../api/library";
import { matchCommands } from "../../lib/palette";
import { registry } from "../../registry";
import type { AppContext, CommandDefinition } from "../../registry/types";
import { useCurrentProject } from "../../state/CurrentProject";
import { useNavigation } from "../../state/Navigation";
import { itemIcon, libraryLabel } from "../item/itemDisplay";

type Result = { kind: "command"; command: CommandDefinition } | { kind: "item"; item: Item };

/**
 * The sidebar's search bar. Type to run a command or jump to any item in the open project; the
 * results drop down under the box. Up/Down + Enter on a keyboard, or tap a result. Esc clears it.
 * Ctrl/Cmd+K (handled by the app shell) focuses the box.
 */
export const SidebarSearch = forwardRef<HTMLInputElement, { context: AppContext; onChosen: () => void }>(function SidebarSearch(
  { context, onChosen },
  inputRef,
) {
  const { project } = useCurrentProject();
  const { openItem } = useNavigation();
  const projectId = project?.id ?? null;

  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
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

  const typed = query.trim() !== "";
  // With nothing typed the box stays quiet (the commands are all in the sidebar already).
  const commands = typed ? matchCommands(registry.getCommands(), query) : [];
  const results: Result[] = [
    ...commands.map((command) => ({ kind: "command" as const, command })),
    ...items.map((item) => ({ kind: "item" as const, item })),
  ];
  const active = Math.min(selected, results.length - 1);
  const showResults = focused && typed;

  function choose(result: Result) {
    setQuery("");
    setItems([]);
    onChosen();
    if (result.kind === "command") result.command.run(context);
    else openItem(result.item.id);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
      (e.currentTarget as HTMLInputElement).blur();
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
        id={`search-option-${index}`}
        role="option"
        aria-selected={index === active}
        className={index === active ? "selected" : undefined}
        onMouseMove={() => setSelected(index)}
        // mousedown, not click: the box loses focus first, which would close the list under the pointer
        onMouseDown={(e) => {
          e.preventDefault();
          choose(result);
        }}
      >
        {result.kind === "command" ? (
          result.command.label
        ) : (
          <>
            {itemIcon(result.item)} {result.item.name} <small className="meta">{libraryLabel(result.item)}</small>
          </>
        )}
      </li>
    );
  }

  return (
    <div className="sidebar-search">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={projectId ? "Search or run a command" : "Run a command"}
        aria-label="Search"
        role="combobox"
        aria-expanded={showResults}
        aria-controls="search-results"
        aria-activedescendant={showResults && results[active] ? `search-option-${active}` : undefined}
      />
      {showResults && (
        <div className="search-results">
          <ul id="search-results" role="listbox" aria-label="Search results">
            {commands.length > 0 && (
              <li role="presentation" className="group">
                Commands
              </li>
            )}
            {results.map((r, i) =>
              i === commands.length && r.kind === "item" ? (
                <Fragment key={`items-from-${r.item.id}`}>
                  <li role="presentation" className="group">
                    Pages and items
                  </li>
                  {option(r, i)}
                </Fragment>
              ) : (
                option(r, i)
              ),
            )}
          </ul>
          {results.length === 0 && <p className="empty">Nothing matches “{query.trim()}”.</p>}
          {!projectId && <p className="empty">Open a project to search its items too.</p>}
        </div>
      )}
    </div>
  );
});
