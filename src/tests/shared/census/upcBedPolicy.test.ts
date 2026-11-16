// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  isUpcEligibleBedId,
  isUciEligibleBedId,
  resolveEffectiveUpcState,
  resolveUpcClassificationFromChecklist,
  resolveIsUpcFromChecklist,
  resolveNormalizedUpcFlag,
} from '@/shared/census/upcBedPolicy';

describe('isUpcEligibleBedId', () => {
  it('accepts R1-R4', () => {
    expect(isUpcEligibleBedId('R1')).toBe(true);
    expect(isUpcEligibleBedId('R2')).toBe(true);
    expect(isUpcEligibleBedId('R3')).toBe(true);
    expect(isUpcEligibleBedId('R4')).toBe(true);
  });

  it('accepts NEO1 and NEO2', () => {
    expect(isUpcEligibleBedId('NEO1')).toBe(true);
    expect(isUpcEligibleBedId('NEO2')).toBe(true);
  });

  it('rejects H beds', () => {
    expect(isUpcEligibleBedId('H1C1')).toBe(false);
    expect(isUpcEligibleBedId('H6C2')).toBe(false);
  });

  it('rejects null/undefined/empty', () => {
    expect(isUpcEligibleBedId(null)).toBe(false);
    expect(isUpcEligibleBedId(undefined)).toBe(false);
    expect(isUpcEligibleBedId('')).toBe(false);
  });
});

describe('isUciEligibleBedId', () => {
  it('accepts R1-R4', () => {
    expect(isUciEligibleBedId('R1')).toBe(true);
    expect(isUciEligibleBedId('R4')).toBe(true);
  });

  it('rejects NEO beds (protocol §3: Neo can only be UTI, never UCI)', () => {
    expect(isUciEligibleBedId('NEO1')).toBe(false);
    expect(isUciEligibleBedId('NEO2')).toBe(false);
  });

  it('rejects H beds', () => {
    expect(isUciEligibleBedId('H1C1')).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(isUciEligibleBedId(null)).toBe(false);
    expect(isUciEligibleBedId(undefined)).toBe(false);
  });
});

describe('resolveUpcClassificationFromChecklist', () => {
  it('returns null for undefined checklist', () => {
    expect(resolveUpcClassificationFromChecklist(undefined)).toBeNull();
    expect(resolveUpcClassificationFromChecklist(null)).toBeNull();
  });

  it('returns null for checklist with null classification', () => {
    expect(
      resolveUpcClassificationFromChecklist({
        uciCriteria: [],
        utiCriteria: [],
        classification: null,
        evaluatedAt: '',
      })
    ).toBeNull();
  });

  it('returns the stored classification', () => {
    expect(
      resolveUpcClassificationFromChecklist({
        uciCriteria: ['uci_vmi'],
        utiCriteria: [],
        classification: 'UPC_UCI',
        evaluatedAt: '2026-04-14T00:00:00Z',
      })
    ).toBe('UPC_UCI');
  });
});

describe('resolveIsUpcFromChecklist', () => {
  it('returns false for undefined/null checklist', () => {
    expect(resolveIsUpcFromChecklist(undefined)).toBe(false);
    expect(resolveIsUpcFromChecklist(null)).toBe(false);
  });

  it('returns false for null classification', () => {
    expect(
      resolveIsUpcFromChecklist({
        uciCriteria: [],
        utiCriteria: [],
        classification: null,
        evaluatedAt: '',
      })
    ).toBe(false);
  });

  it('returns true for any classification', () => {
    expect(
      resolveIsUpcFromChecklist({
        uciCriteria: [],
        utiCriteria: ['uti_mon_cardiaca'],
        classification: 'UPC_UTI',
        evaluatedAt: '2026-04-14T00:00:00Z',
      })
    ).toBe(true);
  });
});

describe('resolveNormalizedUpcFlag', () => {
  it('returns true only for eligible beds with isUPC=true', () => {
    expect(resolveNormalizedUpcFlag('R1', true)).toBe(true);
    expect(resolveNormalizedUpcFlag('NEO1', true)).toBe(true);
  });

  it('returns false for ineligible beds even if isUPC=true', () => {
    expect(resolveNormalizedUpcFlag('H1C1', true)).toBe(false);
  });

  it('returns false for eligible beds with isUPC=false', () => {
    expect(resolveNormalizedUpcFlag('R1', false)).toBe(false);
  });

  it('handles null/undefined', () => {
    expect(resolveNormalizedUpcFlag(null, true)).toBe(false);
    expect(resolveNormalizedUpcFlag('R1', null)).toBe(false);
    expect(resolveNormalizedUpcFlag(undefined, undefined)).toBe(false);
  });
});

describe('resolveEffectiveUpcState', () => {
  it('prefers structured checklist data over a stale legacy boolean on eligible beds', () => {
    expect(
      resolveEffectiveUpcState({
        bedId: 'R1',
        isUPC: false,
        checklist: {
          uciCriteria: ['uci_vmi'],
          utiCriteria: [],
          classification: 'UPC_UCI',
          evaluatedAt: '2026-04-18T10:00:00Z',
        },
      })
    ).toEqual({
      classification: 'UPC_UCI',
      isUpc: true,
    });
  });

  it('treats legacy isUPC as UTI when checklist is absent on eligible beds', () => {
    expect(
      resolveEffectiveUpcState({
        bedId: 'R2',
        isUPC: true,
        checklist: undefined,
      })
    ).toEqual({
      classification: 'UPC_UTI',
      isUpc: true,
    });
  });

  it('returns no-upc on ineligible beds even with stale sources', () => {
    expect(
      resolveEffectiveUpcState({
        bedId: 'H1C1',
        isUPC: true,
        checklist: {
          uciCriteria: ['uci_vmi'],
          utiCriteria: [],
          classification: 'UPC_UCI',
          evaluatedAt: '2026-04-18T10:00:00Z',
        },
      })
    ).toEqual({
      classification: null,
      isUpc: false,
    });
  });
});
