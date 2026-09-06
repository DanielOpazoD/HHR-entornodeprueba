import { describe, expect, it } from 'vitest';

import { CLINICAL_LIBRARY_ENTRIES } from '@/features/clinical-library/domain/libraryCatalog';
import {
  countLibraryEntriesByCategory,
  filterLibraryEntries,
  groupLibraryEntriesByCategory,
  matchesLibraryQuery,
  normalizeSearchText,
} from '@/features/clinical-library/domain/librarySearch';
import { parseLocalizedDecimal, roundTo } from '@/features/clinical-library/domain/numberInput';

const byId = (id: string) => {
  const entry = CLINICAL_LIBRARY_ENTRIES.find(candidate => candidate.id === id);
  if (!entry) throw new Error(`missing entry ${id}`);
  return entry;
};

describe('library search', () => {
  it('normalizes accents, case and whitespace', () => {
    expect(normalizeSearchText('  Imagenología   TAC ')).toBe('imagenologia tac');
    expect(normalizeSearchText('CHA₂DS₂-VASc')).toBe('cha₂ds₂-vasc');
  });

  it('matches accent-insensitive tokens against title, description and keywords', () => {
    const imaging = byId('solicitud-imagenologia');
    expect(matchesLibraryQuery(imaging, 'imagenologia')).toBe(true);
    expect(matchesLibraryQuery(imaging, 'MMRAD')).toBe(true);
    expect(matchesLibraryQuery(imaging, 'solicitud tomografia')).toBe(true);
    expect(matchesLibraryQuery(imaging, 'solicitud laboratorio')).toBe(false);
    expect(matchesLibraryQuery(imaging, '   ')).toBe(true);
  });

  it('filters by category and query together', () => {
    const tools = filterLibraryEntries(CLINICAL_LIBRARY_ENTRIES, { query: '', category: 'tools' });
    expect(tools.every(entry => entry.kind === 'tool')).toBe(true);
    expect(tools).toHaveLength(3);

    const noradrenaline = filterLibraryEntries(CLINICAL_LIBRARY_ENTRIES, {
      query: 'noradrenalina',
      category: 'all',
    });
    expect(noradrenaline.map(entry => entry.id)).toEqual(['infusion']);

    expect(
      filterLibraryEntries(CLINICAL_LIBRARY_ENTRIES, { query: 'noradrenalina', category: 'forms' })
    ).toEqual([]);
  });

  it('counts and groups entries in canonical category order, keeping empty groups', () => {
    const counts = countLibraryEntriesByCategory(CLINICAL_LIBRARY_ENTRIES);
    expect(counts.tools).toBe(3);
    expect(counts.forms).toBeGreaterThan(0);
    expect(counts.protocols).toBe(0);
    expect(counts.infographics).toBe(0);

    const groups = groupLibraryEntriesByCategory(CLINICAL_LIBRARY_ENTRIES);
    expect(groups.map(group => group.category)).toEqual([
      'forms',
      'protocols',
      'infographics',
      'tools',
    ]);
    expect(groups[1].entries).toEqual([]);
    expect(groupLibraryEntriesByCategory(CLINICAL_LIBRARY_ENTRIES, ['tools'])).toHaveLength(1);
  });
});

describe('localized number input', () => {
  it('accepts comma and dot decimals and rejects everything else', () => {
    expect(parseLocalizedDecimal('0,1')).toBe(0.1);
    expect(parseLocalizedDecimal('0.1')).toBe(0.1);
    expect(parseLocalizedDecimal(' 70 ')).toBe(70);
    expect(parseLocalizedDecimal(',5')).toBe(0.5);
    expect(parseLocalizedDecimal('')).toBeNull();
    expect(parseLocalizedDecimal('1,000.5')).toBeNull();
    expect(parseLocalizedDecimal('abc')).toBeNull();
    expect(parseLocalizedDecimal('1e3')).toBeNull();
  });

  it('rounds to the requested decimals without floating noise', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(26.25, 1)).toBe(26.3);
  });
});
