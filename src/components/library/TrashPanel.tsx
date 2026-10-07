import {
  purgeFolder,
  purgeItem,
  restoreFolder,
  restoreItem,
  type Trash,
} from "../../api/library";
import { ConfirmButton } from "../ConfirmButton";

/** What's been deleted from this library, with restore and permanent delete. */
export function TrashPanel({
  trash,
  run,
  emptyAll,
}: {
  trash: Trash;
  run: (action: () => Promise<unknown>) => Promise<void>;
  emptyAll: () => Promise<unknown>;
}) {
  const count = trash.folders.length + trash.items.length;

  return (
    <section className="trash" aria-label="Trash">
      <div className="row">
        <h2 className="grow">Trash</h2>
        {count > 0 && (
          <ConfirmButton
            label="Empty trash"
            confirmLabel="Delete everything forever?"
            onConfirm={() => run(emptyAll)}
          />
        )}
      </div>
      {count === 0 && <p className="empty">The trash is empty.</p>}
      <ul className="list">
        {trash.folders.map((f) => (
          <li key={f.id} className="row wrap">
            <span className="name">📁 {f.name} (and its contents)</span>
            <button onClick={() => run(() => restoreFolder(f.id))}>Restore</button>
            <ConfirmButton
              label="Delete forever"
              onConfirm={() => run(() => purgeFolder(f.id))}
            />
          </li>
        ))}
        {trash.items.map((i) => (
          <li key={i.id} className="row wrap">
            <span className="name">{i.name}</span>
            <button onClick={() => run(() => restoreItem(i.id))}>Restore</button>
            <ConfirmButton
              label="Delete forever"
              onConfirm={() => run(() => purgeItem(i.id))}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
