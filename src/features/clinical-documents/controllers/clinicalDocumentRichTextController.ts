/**
 * Clinical Document Rich Text Controller
 *
 * HTML normalization, sanitization, paste handling, and command
 * execution for clinical document contentEditable editors.
 *
 * Tag and style whitelists are defined in clinicalDocumentHtmlSanitizer.ts.
 */

import {
  ALLOWED_TAGS,
  sanitizeElementStyle,
  preserveElementAttributes,
} from '@/features/clinical-documents/controllers/clinicalDocumentHtmlSanitizer';
import { CLINICAL_DOCUMENT_INDENT_STEP_PX } from '@/features/clinical-documents/controllers/clinicalDocumentFormattingContract';
import { applyClinicalDocumentIndentationCommand } from '@/features/clinical-documents/controllers/clinicalDocumentIndentationController';
import { escapeHtml } from '@/utils/htmlEscape';

const decodeHtmlEntities = (value: string): string => {
  if (!value) {
    return '';
  }

  if (typeof document === 'undefined') {
    return value
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&amp;', '&');
  }

  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
};

const normalizeWhitespaceHtml = (value: string): string =>
  value
    .replace(/<div><br><\/div>/gi, '<br>')
    .replace(/<p><br><\/p>/gi, '<br>')
    .replace(/(<br>\s*){3,}/gi, '<br><br>')
    .trim();

const ORPHAN_TABLE_SECTION_PATTERN = /<(?:tr|td|th|thead|tbody|tfoot)\b/i;
const TABLE_WRAPPER_PATTERN = /<table\b/i;

/**
 * Wraps table rows/cells that arrive without their `<table>` ancestor (e.g. a
 * partial-table paste, or a fragment whose wrapper was stripped upstream) so
 * the HTML parser keeps them as a real table instead of leaving floating
 * `<tr>`/`<td>` that never render as tabular content. The parser foster-parents
 * any non-table siblings back out of the injected `<table>`, so mixed content
 * is preserved correctly.
 */
const wrapOrphanTableSections = (value: string): string =>
  ORPHAN_TABLE_SECTION_PATTERN.test(value) && !TABLE_WRAPPER_PATTERN.test(value)
    ? `<table>${value}</table>`
    : value;

/** Converts plain text to sanitized HTML suitable for clinical document storage. */
export const convertPlainTextToClinicalDocumentHtml = (value: string): string => {
  const normalized = decodeHtmlEntities(value).trim();
  if (!normalized) {
    return '';
  }

  return normalizeWhitespaceHtml(escapeHtml(normalized).replace(/\n/g, '<br>'));
};

/**
 * Recursively sanitizes HTML, keeping only whitelisted tags and safe styles.
 * @param value - Raw HTML string to sanitize
 * @returns Sanitized HTML with normalized whitespace
 */
export const sanitizeClinicalDocumentHtml = (value: string): string => {
  if (!value.trim()) {
    return '';
  }

  if (typeof document === 'undefined') {
    return value.replace(/<[^>]+>/g, '').trim();
  }

  const template = document.createElement('template');
  template.innerHTML = wrapOrphanTableSections(value);

  const sanitizeNode = (node: Node): Node[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      return [document.createTextNode(node.textContent || '')];
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return [];
    }

    const element = node as HTMLElement;
    const tagName = element.tagName.toUpperCase();
    const sanitizedChildren = Array.from(element.childNodes).flatMap(child => sanitizeNode(child));

    if (!ALLOWED_TAGS.has(tagName)) {
      return sanitizedChildren;
    }

    const clone = document.createElement(tagName.toLowerCase());
    const safeStyle = sanitizeElementStyle(element, tagName);
    if (safeStyle) {
      clone.setAttribute('style', safeStyle);
    }
    preserveElementAttributes(element, clone, tagName);
    sanitizedChildren.forEach(child => clone.appendChild(child));
    return [clone];
  };

  const fragment = document.createDocumentFragment();
  Array.from(template.content.childNodes)
    .flatMap(child => sanitizeNode(child))
    .forEach(child => fragment.appendChild(child));

  const container = document.createElement('div');
  container.appendChild(fragment);
  return normalizeWhitespaceHtml(container.innerHTML);
};

const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;

/**
 * Normalizes content for Firestore storage, auto-detecting HTML vs plain text.
 * @param value - Raw editor content (HTML or plain text)
 * @returns Sanitized HTML ready for persistence
 */
export const normalizeClinicalDocumentContentForStorage = (value: string): string => {
  if (!value.trim()) {
    return '';
  }

  return HTML_TAG_PATTERN.test(value)
    ? sanitizeClinicalDocumentHtml(value)
    : convertPlainTextToClinicalDocumentHtml(value);
};

/**
 * Strips HTML to produce readable plain text, preserving list markers and line breaks.
 * @param value - HTML content from a clinical document section
 * @returns Plain text representation
 */
export const stripClinicalDocumentHtml = (value: string): string => {
  const normalized = normalizeClinicalDocumentContentForStorage(value);
  if (!normalized) {
    return '';
  }

  const resolveInlineIndentDepth = (element: HTMLElement): number => {
    const marginLeft = element.style.marginLeft;
    if (!marginLeft) {
      return 0;
    }

    const parsed = Number.parseInt(marginLeft, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }

    return Math.max(0, Math.round(parsed / CLINICAL_DOCUMENT_INDENT_STEP_PX));
  };

  const indentMultilineText = (value: string, depth: number): string => {
    if (depth <= 0 || !value.trim()) {
      return value;
    }

    const prefix = '  '.repeat(depth);
    return value
      .split('\n')
      .map(line => (line.trim() ? `${prefix}${line}` : line))
      .join('\n');
  };

  const serializeNodesToText = (nodes: NodeListOf<ChildNode> | ChildNode[], depth = 0): string => {
    const chunks: string[] = [];

    Array.from(nodes).forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        chunks.push(node.textContent || '');
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const element = node as HTMLElement;
      const tagName = element.tagName.toUpperCase();

      if (tagName === 'BR') {
        chunks.push('\n');
        return;
      }

      if (tagName === 'UL') {
        const listText = Array.from(element.children)
          .filter(child => child.tagName.toUpperCase() === 'LI')
          .map(child => serializeListItem(child as HTMLElement, depth, false, 0))
          .join('\n');
        chunks.push(listText, '\n');
        return;
      }

      if (tagName === 'OL') {
        const listText = Array.from(element.children)
          .filter(child => child.tagName.toUpperCase() === 'LI')
          .map((child, index) => serializeListItem(child as HTMLElement, depth, true, index + 1))
          .join('\n');
        chunks.push(listText, '\n');
        return;
      }

      const nextDepth =
        depth + resolveInlineIndentDepth(element) + (tagName === 'BLOCKQUOTE' ? 1 : 0);
      const text = indentMultilineText(
        serializeNodesToText(element.childNodes, nextDepth),
        nextDepth
      );
      chunks.push(text);
      if (['P', 'DIV', 'BLOCKQUOTE', 'LI'].includes(tagName)) {
        chunks.push('\n');
      }
    });

    return chunks.join('');
  };

  const serializeListItem = (
    element: HTMLElement,
    depth: number,
    ordered: boolean,
    orderedIndex: number
  ): string => {
    const indent = '  '.repeat(depth);
    const marker = ordered ? `${orderedIndex}. ` : '• ';
    const inlineChunks: string[] = [];
    const nestedChunks: string[] = [];

    Array.from(element.childNodes).forEach(child => {
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        ['UL', 'OL'].includes((child as HTMLElement).tagName.toUpperCase())
      ) {
        nestedChunks.push(serializeNodesToText([child], depth + 1).trimEnd());
      } else {
        inlineChunks.push(serializeNodesToText([child], depth));
      }
    });

    const mainLine = `${indent}${marker}${inlineChunks.join('').trim()}`.trimEnd();
    return nestedChunks.length ? [mainLine, ...nestedChunks].join('\n') : mainLine;
  };

  if (typeof document === 'undefined') {
    return normalized
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|blockquote|li)>/gi, '\n')
      .replace(/<ol>/gi, '\n')
      .replace(/<\/ol>/gi, '\n')
      .replace(/<ul>/gi, '\n')
      .replace(/<\/ul>/gi, '\n')
      .replace(/<li>/gi, '• ')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const container = document.createElement('div');
  container.innerHTML = normalized;
  return serializeNodesToText(container.childNodes)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Sanitizes pasted HTML: strips all inline styles, classes, and
 * non-structural attributes while preserving images, tables, and
 * basic formatting tags. Falls back to plain text if no HTML is available.
 */
export const sanitizePastedHtml = (html: string): string => {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, '').trim();
  }

  const template = document.createElement('template');
  template.innerHTML = wrapOrphanTableSections(html);

  const sanitizeNode = (node: Node): Node[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      return [document.createTextNode(node.textContent || '')];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return [];
    }

    const element = node as HTMLElement;
    const tagName = element.tagName.toUpperCase();
    const children = Array.from(element.childNodes).flatMap(c => sanitizeNode(c));

    if (!ALLOWED_TAGS.has(tagName)) {
      return children;
    }

    const clone = document.createElement(tagName.toLowerCase());
    const safeStyle = sanitizeElementStyle(element, tagName, { forPaste: true });
    if (safeStyle) {
      clone.setAttribute('style', safeStyle);
    }
    preserveElementAttributes(element, clone, tagName);
    children.forEach(c => clone.appendChild(c));
    return [clone];
  };

  const fragment = document.createDocumentFragment();
  Array.from(template.content.childNodes)
    .flatMap(c => sanitizeNode(c))
    .forEach(c => fragment.appendChild(c));

  const container = document.createElement('div');
  container.appendChild(fragment);
  return normalizeWhitespaceHtml(container.innerHTML);
};

/**
 * Executes a `document.execCommand` formatting command on the active selection.
 * @param command - The editing command (e.g. 'bold', 'insertUnorderedList')
 * @param value - Optional command value (e.g. color hex for 'foreColor')
 * @returns Whether the command was executed successfully
 */
export const applyClinicalDocumentEditorCommand = (
  command:
    | 'bold'
    | 'italic'
    | 'underline'
    | 'foreColor'
    | 'hiliteColor'
    | 'insertUnorderedList'
    | 'insertOrderedList'
    | 'removeFormat'
    | 'undo'
    | 'redo'
    | 'indent'
    | 'outdent',
  value?: string
): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }

  if (command === 'indent' || command === 'outdent') {
    return applyClinicalDocumentIndentationCommand(command);
  }

  return document.execCommand(command, false, value);
};
