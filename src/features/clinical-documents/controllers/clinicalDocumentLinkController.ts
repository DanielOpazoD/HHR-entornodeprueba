/**
 * clinicalDocumentLinkController
 *
 * Pure logic for building and validating hyperlink HTML
 * to insert into the clinical document rich-text editor.
 */

import { escapeHtml } from '@/utils/htmlEscape';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinkInsertionConfig {
  /** The URL for the hyperlink (must be a valid http/https URL). */
  url: string;
  /** Display text for the link. Falls back to the URL if empty. */
  text: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Matches URLs starting with http:// or https://. */
const URL_PATTERN = /^https?:\/\/.+/i;

/**
 * Validates a link insertion config.
 *
 * @param config - URL and display text to validate.
 * @returns Error message string, or null if the config is valid.
 */
export const validateLinkConfig = (config: LinkInsertionConfig): string | null => {
  const trimmedUrl = config.url.trim();

  if (!trimmedUrl) {
    return 'La URL es requerida';
  }

  if (!URL_PATTERN.test(trimmedUrl)) {
    return 'La URL debe comenzar con http:// o https://';
  }

  return null;
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Builds an `<a>` tag HTML string ready to be inserted via `insertHTML`.
 *
 * Links open in a new tab (`target="_blank"`) with `rel="noopener noreferrer"`
 * for security.
 *
 * @param config - URL and display text.
 * @returns Anchor tag HTML string.
 */
export const buildClinicalDocumentLinkHtml = (config: LinkInsertionConfig): string => {
  const url = config.url.trim();
  const text = config.text.trim() || url;

  // Escape quotes in URL to prevent HTML injection
  const safeUrl = url.replace(/"/g, '&quot;');

  return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color:#0369a1;text-decoration:underline">${escapeHtml(text)}</a>`;
};
