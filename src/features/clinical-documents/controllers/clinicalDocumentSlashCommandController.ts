/**
 * Clinical Document Slash Command Controller
 *
 * Detects slash commands typed in the rich text editor and resolves
 * them to text insertions. Pure logic — no React or DOM dependencies.
 *
 * Currently supported commands:
 * - `/lab` — Inserts the most recent lab results summary
 *
 * Detection requires the command followed by at least one whitespace
 * character at the end of the text content (e.g., "/lab " or "/lab\n").
 */

/** Pattern: "/lab" followed by one or more whitespace chars at end of text. */
const SLASH_LAB_DETECT = /\/lab\s+$/;

/**
 * Pattern for removing the typed command from the editor HTML.
 *
 * The command is always the LAST thing in the text flow (see SLASH_LAB_DETECT),
 * so the match is anchored to the trailing text via a lookahead that only
 * permits whitespace, `<br>`, and closing tags before the end of the string.
 * This prevents a `/lab` substring inside an attribute (e.g. an image `src` or
 * link `href` such as `https://host/lab/result.png`) from being struck instead
 * of the user's command, which would corrupt the markup.
 */
const SLASH_LAB_REMOVE = /\/lab\s*(?=(?:\s*(?:<br\s*\/?>|<\/[^>]+>))*\s*$)/;

/**
 * Pattern matching the typed command at the end of a plain-text run. Used to
 * strip the command directly from the caret's text node, which preserves the
 * cursor (unlike a full innerHTML rewrite).
 */
export const SLASH_LAB_TEXT_REMOVE = /\/lab\s*$/;

/**
 * Checks if the editor's text content ends with a recognized slash command.
 *
 * @param textContent - Plain text content of the editor (not HTML)
 * @returns The command name or null if no match
 */
export const detectSlashCommand = (textContent: string): 'lab' | null => {
  if (SLASH_LAB_DETECT.test(textContent)) {
    return 'lab';
  }
  return null;
};

/**
 * Removes the slash command text from the editor's innerHTML.
 *
 * @param innerHTML - Raw HTML content of the editor
 * @returns HTML with the slash command removed
 */
export const removeSlashCommandFromHtml = (innerHTML: string): string =>
  innerHTML.replace(SLASH_LAB_REMOVE, '');
