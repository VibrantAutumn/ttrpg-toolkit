/**
 * The browser's storage, or undefined if it isn't available (a private window or
 * blocked site data can refuse even to hand it over). Only for per-device
 * conveniences, like a remembered choice; never for anything that must last.
 */
export function deviceStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
