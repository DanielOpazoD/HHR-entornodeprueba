import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildClinicalDocumentPrintHtml } from '@/features/clinical-documents/services/clinicalDocumentPrintHtmlBuilder';
import { CLINICAL_DOCUMENT_SHEET_ID } from '@/features/clinical-documents/services/clinicalDocumentPrintSupport';

/**
 * Integration guard for the print HTML assembly. Regression coverage was absent,
 * which is exactly why the B1 escapeHtml unification corrupted the CSS
 * font-family stack (`'Segoe UI'` → `&#39;Segoe UI&#39;`) without a test catching
 * it. These assertions pin the per-context escaping contract.
 */
describe('buildClinicalDocumentPrintHtml', () => {
  beforeEach(() => {
    const sheet = document.createElement('section');
    sheet.id = CLINICAL_DOCUMENT_SHEET_ID;
    sheet.innerHTML =
      '<div class="clinical-document-section-block">' +
      '<h3 class="clinical-document-section-title">Diagnósticos</h3>' +
      '<div class="clinical-document-rich-text-editor"><p>Contenido clínico</p></div>' +
      '</div>';
    document.body.appendChild(sheet);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const fontFamilyDeclaration = (html: string): string =>
    html.match(/font-family:([^;]*);/)?.[1] ?? '';

  it('keeps the font-family stack valid CSS — preserves quotes, never HTML-escapes it', async () => {
    const html = await buildClinicalDocumentPrintHtml({
      bodyFontFamily: "Inter, 'Segoe UI', sans-serif",
    });

    expect(html).not.toBeNull();
    const fontFamily = fontFamilyDeclaration(html!);
    expect(fontFamily).toBe("Inter, 'Segoe UI', sans-serif");
    // The B1 regression: an HTML-escaped quote (`&#39;`) here is invalid CSS.
    expect(fontFamily).not.toContain('&#39;');
    expect(fontFamily).not.toContain('&quot;');
  });

  it('neutralizes a <style>/declaration breakout attempt in bodyFontFamily', async () => {
    const html = await buildClinicalDocumentPrintHtml({
      bodyFontFamily: 'Arial;}</style><script>alert(1)</script>',
    });

    expect(html).not.toBeNull();
    // sanitizeCssValue strips `<>{};`, so neither the style tag nor a script can
    // re-form inside the <style> block.
    expect(html).not.toContain('</style><script>');
    expect(fontFamilyDeclaration(html!)).not.toMatch(/[<>{}]/);
  });

  it('HTML-escapes the page title (a genuine HTML context)', async () => {
    const html = await buildClinicalDocumentPrintHtml({ pageTitle: 'A & B "C"' });

    expect(html).toContain('<title>A &amp; B &quot;C&quot;</title>');
  });
});
