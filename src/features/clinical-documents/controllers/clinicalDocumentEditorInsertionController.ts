const escapeClinicalDocumentHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const restoreSelectionAfterInsertion = (
  selection: Selection | null,
  range: Range,
  lastInsertedNode: ChildNode | null
) => {
  if (!selection || !lastInsertedNode) {
    return;
  }

  range.setStartAfter(lastInsertedNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

export const insertClinicalDocumentHtmlAtCursor = (editor: HTMLDivElement, html: string): void => {
  if (typeof document === 'undefined') {
    editor.innerHTML = `${editor.innerHTML}${html}`;
    return;
  }

  const selection = window.getSelection();
  const range =
    selection &&
    selection.rangeCount > 0 &&
    editor.contains(selection.anchorNode) &&
    editor.contains(selection.focusNode)
      ? selection.getRangeAt(0)
      : null;

  if (!range) {
    editor.innerHTML = `${editor.innerHTML}${html}`;
    return;
  }

  range.deleteContents();
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = template.content.cloneNode(true) as DocumentFragment;
  const lastInsertedNode = fragment.lastChild;
  range.insertNode(fragment);
  restoreSelectionAfterInsertion(selection, range, lastInsertedNode);
};

export const insertClinicalDocumentPlainTextAtCursor = (
  editor: HTMLDivElement,
  text: string
): void => {
  const html = escapeClinicalDocumentHtml(text).replace(/\n/g, '<br>');
  insertClinicalDocumentHtmlAtCursor(editor, html);
};

/** Upper bound on how far back to look for the trailing pattern (chars). */
const TRAILING_PATTERN_LOOKBACK = 64;

/** Block-level tags that bound an inline run (the walk never crosses them). */
const BLOCK_BOUNDARY_TAGS = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'TD', 'TH']);

/** Nearest block-level ancestor of `node` within `editor` (the editor itself if none). */
const resolveBlockContainer = (node: Node, editor: HTMLElement): HTMLElement => {
  let current: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  while (current && current !== editor) {
    if (BLOCK_BOUNDARY_TAGS.has(current.tagName.toUpperCase())) {
      return current;
    }
    current = current.parentElement;
  }
  return editor;
};

/**
 * Removes a trailing pattern (e.g. a typed `/lab ` slash command) that ends at
 * the collapsed caret, deleting it from the text flow so the cursor stays put.
 * Handles the command spanning several adjacent text nodes (e.g. across an
 * inline formatting boundary). Returns `true` if it removed the match, `false`
 * if the caret is not a collapsed position whose preceding text ends with the
 * pattern (the caller should then fall back to an innerHTML-level strip).
 *
 * Preserving the caret matters: a full `innerHTML` rewrite collapses the
 * selection, which makes a subsequent cursor insertion fall back to appending
 * at the end of the editor instead of where the user was typing.
 */
export const removeTrailingPatternAtCaret = (editor: HTMLDivElement, pattern: RegExp): boolean => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return false;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  const caretNode = range.endContainer;
  if (!range.collapsed || caretNode.nodeType !== Node.TEXT_NODE || !editor.contains(caretNode)) {
    return false;
  }

  // Collect a bounded run of text ending at the caret, walking back across
  // adjacent text nodes so a command split by inline markup is still matched —
  // but never crossing a block boundary, so `/la` ending one block and `b `
  // starting the next are NOT spliced into a spurious `/lab` match.
  const caretBlock = resolveBlockContainer(caretNode, editor);
  const segments: Array<{ node: Text; length: number }> = [
    { node: caretNode as Text, length: range.endOffset },
  ];
  let textBeforeCaret = (caretNode.textContent ?? '').slice(0, range.endOffset);

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  walker.currentNode = caretNode;
  while (textBeforeCaret.length < TRAILING_PATTERN_LOOKBACK) {
    const previous = walker.previousNode();
    if (!previous || !caretBlock.contains(previous)) {
      break;
    }
    const text = previous.textContent ?? '';
    segments.unshift({ node: previous as Text, length: text.length });
    textBeforeCaret = text + textBeforeCaret;
  }

  const match = textBeforeCaret.match(pattern);
  if (!match || match[0].length === 0) {
    return false;
  }

  // Map the match start (an offset into the collected text) back to a node.
  const matchStartInText = textBeforeCaret.length - match[0].length;
  let startNode: Text = caretNode as Text;
  let startOffset = range.endOffset;
  let consumed = 0;
  for (const segment of segments) {
    if (matchStartInText <= consumed + segment.length) {
      startNode = segment.node;
      startOffset = matchStartInText - consumed;
      break;
    }
    consumed += segment.length;
  }

  const removalRange = document.createRange();
  removalRange.setStart(startNode, startOffset);
  removalRange.setEnd(caretNode, range.endOffset);
  removalRange.deleteContents();
  // After deleteContents the range is collapsed at the start — reuse it as caret.
  selection.removeAllRanges();
  selection.addRange(removalRange);
  return true;
};
