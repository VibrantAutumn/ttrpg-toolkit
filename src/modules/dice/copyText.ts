/**
 * Copies text to the clipboard. Returns false if the system refuses (some
 * Android WebViews do), so the caller can tell the user instead of failing silently.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
