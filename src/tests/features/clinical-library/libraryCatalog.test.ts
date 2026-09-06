import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CLINICAL_LIBRARY_ENTRIES,
  LIBRARY_CATEGORIES,
  findLibraryCategory,
  findLibraryEntry,
} from '@/features/clinical-library/domain/libraryCatalog';
import {
  LIBRARY_CATEGORY_IDS,
  LIBRARY_DOCUMENT_FORMATS,
  LIBRARY_TOOL_IDS,
  type LibraryDocumentEntry,
  type LibraryToolEntry,
} from '@/features/clinical-library/domain/libraryCatalogTypes';

const documents = CLINICAL_LIBRARY_ENTRIES.filter(
  (entry): entry is LibraryDocumentEntry => entry.kind === 'document'
);
const tools = CLINICAL_LIBRARY_ENTRIES.filter(
  (entry): entry is LibraryToolEntry => entry.kind === 'tool'
);

const EXTENSIONS_BY_FORMAT: Record<(typeof LIBRARY_DOCUMENT_FORMATS)[number], RegExp> = {
  pdf: /\.pdf$/i,
  docx: /\.docx$/i,
  image: /\.(png|jpe?g|webp)$/i,
};

const RUT_PATTERN = /\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b/;

describe('clinical library catalog', () => {
  it('declares every category once and resolves unknown ids to the first category', () => {
    expect(LIBRARY_CATEGORIES.map(category => category.id)).toEqual([...LIBRARY_CATEGORY_IDS]);
    expect(findLibraryCategory('tools').label).toBe('Herramientas');
  });

  it('uses unique ids and known categories', () => {
    const ids = CLINICAL_LIBRARY_ENTRIES.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of CLINICAL_LIBRARY_ENTRIES) {
      expect(LIBRARY_CATEGORY_IDS).toContain(entry.category);
      expect(entry.title.trim()).not.toBe('');
      expect(entry.description.trim()).not.toBe('');
      expect(entry.keywords.length).toBeGreaterThan(0);
    }
    expect(findLibraryEntry('instrumento-cudyr')?.kind).toBe('document');
    expect(findLibraryEntry('missing')).toBeUndefined();
  });

  it('points every document to a real public asset outside the PWA precache', () => {
    expect(documents.length).toBeGreaterThan(0);
    for (const document of documents) {
      expect(document.url, document.id).toMatch(/^\/(docs|templates|images\/forms)\//);
      const file = path.join(process.cwd(), 'public', decodeURI(document.url));
      expect(fs.existsSync(file), `${document.id} → ${document.url}`).toBe(true);
      const sizeKb = fs.statSync(file).size / 1024;
      expect(
        Math.abs(sizeKb - document.sizeKb),
        `${document.id} declares ${document.sizeKb} KB but the file has ${sizeKb.toFixed(1)} KB`
      ).toBeLessThanOrEqual(Math.max(5, document.sizeKb * 0.05));
      expect(document.url, document.id).toMatch(EXTENSIONS_BY_FORMAT[document.format]);
    }
  });

  it('declares each interactive tool exactly once', () => {
    expect(tools.map(tool => tool.id).sort()).toEqual([...LIBRARY_TOOL_IDS].sort());
    for (const tool of tools) expect(tool.category).toBe('tools');
  });

  it('never carries patient identifiers in titles, descriptions or keywords', () => {
    for (const entry of CLINICAL_LIBRARY_ENTRIES) {
      const text = [entry.title, entry.description, ...entry.keywords].join(' ');
      expect(text, entry.id).not.toMatch(RUT_PATTERN);
    }
  });
});
