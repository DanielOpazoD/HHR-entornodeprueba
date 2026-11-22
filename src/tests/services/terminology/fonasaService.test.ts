/**
 * Tests for the FONASA billing code search service.
 */

import { describe, expect, it } from 'vitest';
import {
  searchFonasa,
  expandQueryTokens,
} from '@/features/clinical-documents/services/fonasaService';

// ---------------------------------------------------------------------------
// expandQueryTokens (abbreviation expansion)
// ---------------------------------------------------------------------------

describe('expandQueryTokens', () => {
  it('expands "Qx" to surgical terms', () => {
    const tokens = expandQueryTokens('Qx');

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toContain('quirurgica');
    expect(tokens[0]).toContain('cirugia');
  });

  it('expands "trat quir" to two token groups', () => {
    const tokens = expandQueryTokens('trat quir');

    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toContain('tratamiento');
    expect(tokens[1]).toContain('quirurgica');
  });

  it('expands anatomy shortcut "vesicula" to include colecistectomía', () => {
    const tokens = expandQueryTokens('vesícula');

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toContain('colecistectomia');
  });

  it('keeps unknown words as-is', () => {
    const tokens = expandQueryTokens('apendicectomía');

    expect(tokens).toEqual([['apendicectomia']]);
  });

  it('filters out single-char tokens', () => {
    const tokens = expandQueryTokens('a b Qx');

    expect(tokens).toHaveLength(1); // only "Qx" kept
  });

  it('handles empty query', () => {
    expect(expandQueryTokens('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// searchFonasa (smart local search)
// ---------------------------------------------------------------------------

describe('searchFonasa', () => {
  it('returns empty array for short queries', async () => {
    expect(await searchFonasa('interventions', '')).toEqual([]);
    expect(await searchFonasa('interventions', 'a')).toEqual([]);
  });

  it('finds interventions by code prefix', async () => {
    const results = await searchFonasa('interventions', '1103001');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].code).toBe('1103001');
  });

  it('finds interventions by description keyword', async () => {
    const results = await searchFonasa('interventions', 'craneoplastía');

    expect(results.length).toBeGreaterThan(0);
  });

  it('finds via abbreviation expansion: "Qx" → quirúrgica entries', async () => {
    const results = await searchFonasa('interventions', 'Qx');

    expect(results.length).toBeGreaterThan(0);
    const hasQuir = results.some(r => r.description.toLowerCase().includes('quir'));
    expect(hasQuir).toBe(true);
  });

  it('finds via anatomy shortcut: "vesícula" → colecistectomía', async () => {
    const results = await searchFonasa('interventions', 'vesícula');

    expect(results.length).toBeGreaterThan(0);
    const hasColecist = results.some(r => r.description.toLowerCase().includes('colecist'));
    expect(hasColecist).toBe(true);
  });

  it('multi-token AND match scores higher than single-token', async () => {
    const results = await searchFonasa('interventions', 'trat quir');

    expect(results.length).toBeGreaterThan(0);
    // "trat. quir." entries should rank first (both tokens match)
    const firstDesc = results[0].description.toLowerCase();
    expect(firstDesc.includes('trat') || firstDesc.includes('quir')).toBe(true);
  });

  it('finds procedures by description keyword', async () => {
    const results = await searchFonasa('procedures', 'mamografía');

    expect(results.length).toBeGreaterThan(0);
  });

  it('search is accent-insensitive', async () => {
    const results = await searchFonasa('procedures', 'mamografia');

    expect(results.length).toBeGreaterThan(0);
  });

  it('search is case-insensitive', async () => {
    const results = await searchFonasa('interventions', 'CRANEOPLASTÍA');

    expect(results.length).toBeGreaterThan(0);
  });

  it('returns at most 15 results', async () => {
    const results = await searchFonasa('interventions', 'de');

    expect(results.length).toBeLessThanOrEqual(15);
  });

  it('finds via imaging abbreviation: "TAC" → tomografía', async () => {
    const results = await searchFonasa('procedures', 'TAC');

    expect(results.length).toBeGreaterThan(0);
    const hasTomo = results.some(r => r.description.toLowerCase().includes('tomograf'));
    expect(hasTomo).toBe(true);
  });

  it('finds via abbreviation: "eco" → ecografía', async () => {
    const results = await searchFonasa('procedures', 'eco');

    expect(results.length).toBeGreaterThan(0);
    const hasEco = results.some(r => r.description.toLowerCase().includes('ecograf'));
    expect(hasEco).toBe(true);
  });

  it('finds fractura entries via "hueso"', async () => {
    const results = await searchFonasa('interventions', 'hueso');

    expect(results.length).toBeGreaterThan(0);
    const hasFractura = results.some(
      r =>
        r.description.toLowerCase().includes('fractura') ||
        r.description.toLowerCase().includes('osteosintesis') ||
        r.description.toLowerCase().includes('osea')
    );
    expect(hasFractura).toBe(true);
  });
});
