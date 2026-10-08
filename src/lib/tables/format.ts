/** A table result as one readable line, e.g. `Rumors → A dragon sleeps under the mill`. */
export function formatTableResult(tableName: string, text: string): string {
  return `${tableName} → ${text}`;
}
