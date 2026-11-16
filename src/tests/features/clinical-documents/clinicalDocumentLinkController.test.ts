// @vitest-environment node
/**
 * Tests for the clinical document link controller.
 */

import { describe, expect, it } from 'vitest';
import {
  buildClinicalDocumentLinkHtml,
  validateLinkConfig,
} from '@/features/clinical-documents/controllers/clinicalDocumentLinkController';

// ---------------------------------------------------------------------------
// validateLinkConfig
// ---------------------------------------------------------------------------

describe('validateLinkConfig', () => {
  it('returns null for a valid https URL', () => {
    expect(validateLinkConfig({ url: 'https://example.com', text: 'Example' })).toBeNull();
  });

  it('returns null for a valid http URL', () => {
    expect(validateLinkConfig({ url: 'http://example.com', text: '' })).toBeNull();
  });

  it('returns error for empty URL', () => {
    expect(validateLinkConfig({ url: '', text: 'test' })).toContain('requerida');
  });

  it('returns error for URL without protocol', () => {
    expect(validateLinkConfig({ url: 'example.com', text: '' })).toContain('http');
  });

  it('returns error for non-http protocol', () => {
    expect(validateLinkConfig({ url: 'ftp://files.com', text: '' })).toContain('http');
  });

  it('trims whitespace from URL before validating', () => {
    expect(validateLinkConfig({ url: '  https://x.com  ', text: '' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildClinicalDocumentLinkHtml
// ---------------------------------------------------------------------------

describe('buildClinicalDocumentLinkHtml', () => {
  it('generates an anchor tag with the given URL and text', () => {
    const html = buildClinicalDocumentLinkHtml({ url: 'https://example.com', text: 'Click here' });

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('>Click here</a>');
  });

  it('uses the URL as text when text is empty', () => {
    const html = buildClinicalDocumentLinkHtml({ url: 'https://example.com', text: '' });

    expect(html).toContain('>https://example.com</a>');
  });

  it('adds target="_blank" and rel="noopener noreferrer"', () => {
    const html = buildClinicalDocumentLinkHtml({ url: 'https://x.com', text: 'X' });

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('applies link styling with color and underline', () => {
    const html = buildClinicalDocumentLinkHtml({ url: 'https://x.com', text: 'X' });

    expect(html).toContain('text-decoration:underline');
    expect(html).toContain('color:#0369a1');
  });

  it('escapes HTML special characters in display text', () => {
    const html = buildClinicalDocumentLinkHtml({
      url: 'https://x.com',
      text: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes quotes in URL', () => {
    const html = buildClinicalDocumentLinkHtml({
      url: 'https://x.com/path?a="b"',
      text: 'test',
    });

    expect(html).toContain('&quot;');
    expect(html).not.toContain('href="https://x.com/path?a="b""');
  });

  it('trims whitespace from URL and text', () => {
    const html = buildClinicalDocumentLinkHtml({
      url: '  https://x.com  ',
      text: '  My link  ',
    });

    expect(html).toContain('href="https://x.com"');
    expect(html).toContain('>My link</a>');
  });
});
