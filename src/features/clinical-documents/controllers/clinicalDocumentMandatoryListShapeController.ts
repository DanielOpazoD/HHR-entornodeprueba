/**
 * Clinical Document Mandatory List Shape Controller
 *
 * Restores the list wrapper (`<ol>` or `<ul>`) on editors whose section
 * canonically renders as a list (e.g. "Diagnósticos de egreso", "Indicaciones
 * al alta"). Without this, a user could backspace through the wrapper and
 * lose the auto-list behavior — typing a new line would no longer produce
 * a numbered or dashed marker.
 *
 * Pure DOM utilities. Depends on the canonical HTML sanitizer so the rebuilt
 * list can never reintroduce unsafe markup (see enforceMandatoryListShape).
 */

import type { ClinicalDocumentMandatoryListType } from '@/features/clinical-documents/controllers/clinicalDocumentEmptySectionTemplateController';
import { sanitizeClinicalDocumentHtml } from '@/features/clinical-documents/controllers/clinicalDocumentRichTextController';
import { escapeHtml } from '@/utils/htmlEscape';

/**
 * Returns true if the editor already complies with the mandatory list shape:
 * the first non-text child is the required list tag, contains at least one
 * `<li>`, and has no extra siblings outside it.
 */
export const editorMatchesMandatoryListShape = (
  editor: HTMLElement,
  listTag: ClinicalDocumentMandatoryListType
): boolean => {
  const firstElement = editor.firstElementChild;
  if (!firstElement) return false;
  if (firstElement.tagName.toLowerCase() !== listTag) return false;
  if (!firstElement.querySelector('li')) return false;
  if (firstElement.nextElementSibling) return false;
  return true;
};

const BLOCK_LEVEL_TAGS = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE']);
const LIST_CONTAINER_TAGS = new Set(['UL', 'OL']);

interface EditorLine {
  /** Inner HTML of the line, with inline formatting (b/i/u/span/a) preserved. */
  html: string;
  /** Visible text of the line, used only to drop blank lines. */
  text: string;
}

/**
 * Walks the editor's DOM and produces one logical line per block-level
 * descendant (divs, paragraphs, list items) and per `<br>`. Unlike a plain
 * text extraction, inline formatting elements (`<b>`, `<i>`, `<u>`,
 * `<span style="color…">`, `<a>`) are preserved as HTML so that rebuilding the
 * mandatory list wrapper never discards the user's emphasis/colour/links.
 *
 * Implemented manually because `Element.innerText` is not faithful in jsdom
 * (it concatenates without block-boundary newlines), and we need
 * deterministic behavior across runtimes.
 */
const collectEditorLines = (editor: HTMLElement): EditorLine[] => {
  const lines: EditorLine[] = [];
  let htmlParts: string[] = [];
  let textParts: string[] = [];

  const flush = (): void => {
    if (textParts.join('').trim().length > 0) {
      lines.push({ html: htmlParts.join('').trim(), text: textParts.join('') });
    }
    htmlParts = [];
    textParts = [];
  };

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || '';
      textParts.push(value);
      htmlParts.push(escapeHtml(value));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    const tagName = element.tagName.toUpperCase();

    if (tagName === 'BR') {
      flush();
      return;
    }

    if (BLOCK_LEVEL_TAGS.has(tagName)) {
      flush();
      Array.from(element.childNodes).forEach(visit);
      flush();
      return;
    }

    if (LIST_CONTAINER_TAGS.has(tagName)) {
      Array.from(element.childNodes).forEach(visit);
      return;
    }

    // Inline element (or unknown): keep its markup intact on the current line.
    textParts.push(element.textContent || '');
    htmlParts.push(element.outerHTML);
  };

  Array.from(editor.childNodes).forEach(visit);
  flush();

  return lines;
};

/**
 * Splits the editor's current content into list items, preserving the user's
 * logical line breaks AND any inline formatting within each line. Empty lines
 * are dropped.
 */
const splitEditorTextIntoListItemsHtml = (editor: HTMLElement): string => {
  const lines = collectEditorLines(editor);
  if (lines.length === 0) return '<li><br></li>';
  return lines.map(line => `<li>${line.html}</li>`).join('');
};

/**
 * Places the caret at the end of the last `<li>` inside the editor. Called
 * after rebuilding the list so the user's typing flow is not interrupted.
 */
const placeCaretAtEndOfLastListItem = (editor: HTMLElement): void => {
  const lastLi = editor.querySelector('li:last-child');
  if (!lastLi) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const range = document.createRange();
  range.selectNodeContents(lastLi);
  range.collapse(false);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Reconstructs the mandatory list shape if the user has destroyed the wrapper.
 * No-op when the editor is already in valid shape.
 *
 * Returns `true` if the DOM was mutated, `false` if no fix was needed.
 */
export const enforceMandatoryListShape = (
  editor: HTMLElement,
  listTag: ClinicalDocumentMandatoryListType
): boolean => {
  if (editorMatchesMandatoryListShape(editor, listTag)) {
    return false;
  }

  const itemsHtml = splitEditorTextIntoListItemsHtml(editor);
  // Preserved inline markup (`outerHTML`) is re-run through the sanitizer so a
  // stray event handler / unsafe href can never survive the rebuild, while the
  // documented inline formatting (bold/colour/links) is kept.
  editor.innerHTML = sanitizeClinicalDocumentHtml(`<${listTag}>${itemsHtml}</${listTag}>`);
  placeCaretAtEndOfLastListItem(editor);
  return true;
};
