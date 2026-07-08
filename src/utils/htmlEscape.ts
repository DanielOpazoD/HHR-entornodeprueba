/**
 * Single source of truth for HTML escaping.
 *
 * Escapes the five HTML-significant characters in ONE pass (so it is immune to
 * the ordering bug of chained `.replace` calls, where `&` must run first). The
 * result is safe for BOTH HTML text content AND single/double-quoted attribute
 * values, so call sites never have to pick a context-specific escaper.
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes `&`, `<`, `>`, `"`, and `'` for safe embedding in HTML. */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, char => HTML_ESCAPES[char] ?? char);
