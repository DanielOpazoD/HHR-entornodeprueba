// @vitest-environment node
/**
 * Tests for the clinical document table controller.
 */

import { describe, expect, it } from 'vitest';
import {
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  TABLE_MIN_COLS,
  TABLE_MIN_ROWS,
  buildClinicalDocumentTableHtml,
  validateTableConfig,
} from '@/features/clinical-documents/controllers/clinicalDocumentTableController';

// ---------------------------------------------------------------------------
// buildClinicalDocumentTableHtml
// ---------------------------------------------------------------------------

describe('buildClinicalDocumentTableHtml', () => {
  it('generates a table with correct number of rows and columns', () => {
    const html = buildClinicalDocumentTableHtml({ cols: 3, rows: 4, hasHeader: false });

    const trMatches = html.match(/<tr>/g);
    const tdMatches = html.match(/<td /g);

    expect(trMatches).toHaveLength(4);
    expect(tdMatches).toHaveLength(12); // 3 × 4
  });

  it('uses <th> tags and header styling for the first row when hasHeader is true', () => {
    const html = buildClinicalDocumentTableHtml({ cols: 2, rows: 3, hasHeader: true });

    const thMatches = html.match(/<th /g);
    const tdMatches = html.match(/<td /g);

    expect(thMatches).toHaveLength(2); // first row
    expect(tdMatches).toHaveLength(4); // remaining 2 rows × 2 cols
    expect(html).toContain('font-weight:600');
    expect(html).toContain('Col 1');
    expect(html).toContain('Col 2');
  });

  it('uses only <td> tags when hasHeader is false', () => {
    const html = buildClinicalDocumentTableHtml({ cols: 2, rows: 2, hasHeader: false });

    expect(html).not.toContain('<th');
    expect(html.match(/<td /g)).toHaveLength(4);
  });

  it('includes border-collapse and width:100% styles on the table', () => {
    const html = buildClinicalDocumentTableHtml({ cols: 1, rows: 2, hasHeader: false });

    expect(html).toContain('border-collapse:collapse');
    expect(html).toContain('width:100%');
  });

  it('appends a trailing paragraph for cursor placement', () => {
    const html = buildClinicalDocumentTableHtml({ cols: 1, rows: 2, hasHeader: false });

    expect(html).toContain('</table>');
    expect(html).toContain('<p><br></p>');
  });

  it('clamps columns to allowed range', () => {
    const tooFew = buildClinicalDocumentTableHtml({ cols: 0, rows: 2, hasHeader: false });
    const tooMany = buildClinicalDocumentTableHtml({ cols: 99, rows: 2, hasHeader: false });

    expect(tooFew.match(/<td /g)).toHaveLength(TABLE_MIN_COLS * 2);
    expect(tooMany.match(/<td /g)).toHaveLength(TABLE_MAX_COLS * 2);
  });

  it('clamps rows to allowed range', () => {
    const tooFew = buildClinicalDocumentTableHtml({ cols: 1, rows: 0, hasHeader: false });
    const tooMany = buildClinicalDocumentTableHtml({ cols: 1, rows: 99, hasHeader: false });

    expect(tooFew.match(/<tr>/g)).toHaveLength(TABLE_MIN_ROWS);
    expect(tooMany.match(/<tr>/g)).toHaveLength(TABLE_MAX_ROWS);
  });
});

// ---------------------------------------------------------------------------
// validateTableConfig
// ---------------------------------------------------------------------------

describe('validateTableConfig', () => {
  it('returns null for a valid config', () => {
    expect(validateTableConfig({ cols: 3, rows: 5, hasHeader: true })).toBeNull();
  });

  it('returns error for columns out of range', () => {
    expect(validateTableConfig({ cols: 0, rows: 3, hasHeader: false })).toContain('Columnas');
    expect(validateTableConfig({ cols: 11, rows: 3, hasHeader: false })).toContain('Columnas');
  });

  it('returns error for rows out of range', () => {
    expect(validateTableConfig({ cols: 3, rows: 1, hasHeader: false })).toContain('Filas');
    expect(validateTableConfig({ cols: 3, rows: 21, hasHeader: false })).toContain('Filas');
  });
});
