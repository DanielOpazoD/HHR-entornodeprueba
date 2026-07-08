import { describe, expect, it } from 'vitest';

import {
  applyClinicalDocumentEditorCommand,
  normalizeClinicalDocumentContentForStorage,
  sanitizePastedHtml,
  stripClinicalDocumentHtml,
} from '@/features/clinical-documents/controllers/clinicalDocumentRichTextController';

const MALICIOUS_HTML_PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src="x" onerror="alert(1)">',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="javascript:alert(1)"></object>',
  '<svg><script>alert(1)</script><circle /></svg>',
  '<span onclick="alert(1)">Texto</span>',
  '<span style="color: red; position: fixed; background-image: url(javascript:alert(1)); background-color: yellow;">Marcado</span>',
] as const;

const MALICIOUS_WRAPPERS = [
  (payload: string) => payload,
  (payload: string) => `<div>${payload}</div>`,
  (payload: string) => `<p>${payload}</p>`,
  (payload: string) => `<blockquote>${payload}</blockquote>`,
  (payload: string) => `<ul><li>${payload}</li></ul>`,
] as const;

describe('clinicalDocumentRichTextController', () => {
  it('converts plain text to safe rich text markup', () => {
    expect(normalizeClinicalDocumentContentForStorage('Linea 1\nLinea 2')).toBe(
      'Linea 1<br>Linea 2'
    );
  });

  it('avoids double-encoding html entities coming from contenteditable innerHTML', () => {
    expect(
      normalizeClinicalDocumentContentForStorage('Paciente con &lt; 24h y &gt; 3 episodios')
    ).toBe('Paciente con &lt; 24h y &gt; 3 episodios');
  });

  it('sanitizes unsupported tags and extracts plain text for exports', () => {
    const html = normalizeClinicalDocumentContentForStorage(
      '<script>alert(1)</script><b>Alta</b><div>Sin complicaciones</div><ul><li>Control</li></ul>'
    );

    expect(html).not.toContain('script');
    expect(stripClinicalDocumentHtml(html)).toContain('Alta');
    expect(stripClinicalDocumentHtml(html)).toContain('Sin complicaciones');
    expect(stripClinicalDocumentHtml(html)).toContain('• Control');
  });

  it('preserves blockquote markup used for indentation', () => {
    const html = normalizeClinicalDocumentContentForStorage(
      '<blockquote><div>- Prerrenal</div><blockquote><div>- Renal</div></blockquote></blockquote>'
    );

    expect(html).toContain('<blockquote>');
    expect(html).toContain('<div>- Prerrenal</div>');
    expect(html).toContain('<div>- Renal</div>');
  });

  it('preserves inline indentation styles on block elements', () => {
    const html = normalizeClinicalDocumentContentForStorage(
      '<div style="margin-left: 24px; color: red">Texto</div>'
    );

    expect(html).toContain('margin-left: 24px');
    expect(html).toContain('color: red');
  });

  it('keeps ordered list numbering when extracting plain text for exports', () => {
    const html = normalizeClinicalDocumentContentForStorage(
      '<ol><li>Primer paso</li><li>Segundo paso</li></ol>'
    );

    expect(stripClinicalDocumentHtml(html)).toContain('1. Primer paso');
    expect(stripClinicalDocumentHtml(html)).toContain('2. Segundo paso');
  });

  it('preserves nested ordered list indentation when extracting plain text for exports', () => {
    const html = normalizeClinicalDocumentContentForStorage(
      '<ol><li>Indicaciones<ol><li>Control en 7 días</li><li>Repetir exámenes</li></ol></li><li>Alta</li></ol>'
    );

    const text = stripClinicalDocumentHtml(html);
    expect(text).toContain('1. Indicaciones');
    expect(text).toContain('  1. Control en 7 días');
    expect(text).toContain('  2. Repetir exámenes');
    expect(text).toContain('2. Alta');
  });

  it('drops dangerous tags, attributes and disallowed style properties', () => {
    const html = normalizeClinicalDocumentContentForStorage(
      '<div onclick="alert(1)"><span style="color: red; position: fixed; background-image: url(javascript:alert(1)); background-color: yellow">Texto</span><img src="x" onerror="alert(1)"><iframe src="javascript:alert(1)"></iframe><a href="javascript:alert(1)">enlace</a></div>'
    );

    expect(html).toContain('<span style="color: red; background-color: yellow">Texto</span>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onerror');
    // IMG is allowed but onerror attribute must be stripped
    expect(html).toContain('<img');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('position:');
    expect(html).not.toContain('background-image');

    const text = stripClinicalDocumentHtml(html);
    expect(text).toContain('Texto');
    expect(text).toContain('enlace');
  });

  it('keeps sanitization idempotent across a malicious html corpus', () => {
    for (const wrap of MALICIOUS_WRAPPERS) {
      for (const payload of MALICIOUS_HTML_PAYLOADS) {
        const sanitized = normalizeClinicalDocumentContentForStorage(wrap(payload));
        const resanitized = normalizeClinicalDocumentContentForStorage(sanitized);

        expect(resanitized).toBe(sanitized);
        expect(sanitized).not.toMatch(/<(script|iframe|object|embed|svg|math|style)\b/i);
        expect(sanitized).not.toMatch(/\son[a-z]+\s*=/i);
        expect(sanitized).not.toContain('position:');
        expect(sanitized).not.toContain('background-image');

        expect(() => stripClinicalDocumentHtml(sanitized)).not.toThrow();
      }
    }
  });

  it('applies indent and outdent to the selected block without relying on native execCommand', () => {
    const editor = document.createElement('div');
    editor.className = 'clinical-document-rich-text-editor';
    editor.contentEditable = 'true';

    const block = document.createElement('div');
    block.textContent = 'Linea clínica';
    editor.appendChild(block);
    document.body.appendChild(editor);

    const textNode = block.firstChild;
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.setEnd(textNode!, 5);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(applyClinicalDocumentEditorCommand('indent')).toBe(true);
    expect(block.style.marginLeft).toBe('24px');

    expect(applyClinicalDocumentEditorCommand('outdent')).toBe(true);
    expect(block.style.marginLeft).toBe('');

    editor.remove();
  });

  // -------------------------------------------------------------------------
  // Orphaned table rows/cells (regression: pasting a partial table whose
  // <table> wrapper was lost dropped every cell, because the HTML parser
  // discards <tr>/<td> that have no <table> ancestor)
  // -------------------------------------------------------------------------

  it('preserves pasted table rows that arrive without a <table> wrapper', () => {
    const sanitized = sanitizePastedHtml(
      '<tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr>'
    );
    expect(sanitized).toContain('<table');
    expect(sanitized).toContain('<td>A1</td>');
    expect(sanitized).toContain('<td>B2</td>');
  });

  it('preserves orphaned cells during storage normalization', () => {
    const normalized = normalizeClinicalDocumentContentForStorage('<td>Solo celda</td>');
    expect(normalized).toContain('<table');
    expect(normalized).toContain('Solo celda');
  });

  it('keeps a well-formed table untouched (no double wrapping)', () => {
    const sanitized = sanitizePastedHtml('<table><tbody><tr><td>X</td></tr></tbody></table>');
    expect(sanitized.match(/<table/g) ?? []).toHaveLength(1);
    expect(sanitized).toContain('<td>X</td>');
  });

  it('does not inject a table when there are no table cells', () => {
    const sanitized = sanitizePastedHtml('<p>Texto normal</p>');
    expect(sanitized).not.toContain('<table');
  });
});
