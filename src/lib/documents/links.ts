/** Turns what someone typed into a link address: `example.com` becomes `https://example.com`. */
export function normalizeLinkAddress(typed: string): string {
  const text = typed.trim();
  if (text === "") return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
  if (/^[#/.]/.test(text)) return text;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(text)) return "mailto:" + text;
  return "https://" + text;
}

/** Only web, mail and phone links are handed to the system to open. */
export function canOpenExternally(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href.trim());
}
