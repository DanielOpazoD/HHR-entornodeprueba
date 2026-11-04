// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  resolveUpcClassification,
  resolveUpcClassificationLabel,
} from '@/domain/upc/upcClassification';

describe('resolveUpcClassification', () => {
  it('returns null when no criteria are marked', () => {
    expect(resolveUpcClassification({ uciCriteria: [], utiCriteria: [] })).toBeNull();
    expect(resolveUpcClassification({ uciCriteria: new Set(), utiCriteria: new Set() })).toBeNull();
  });

  it('returns UPC_UTI when only UTI criteria are marked', () => {
    expect(resolveUpcClassification({ uciCriteria: [], utiCriteria: ['uti_mon_cardiaca'] })).toBe(
      'UPC_UTI'
    );
  });

  it('returns UPC_UCI when any UCI criterion is marked', () => {
    expect(resolveUpcClassification({ uciCriteria: ['uci_vmi'], utiCriteria: [] })).toBe('UPC_UCI');
  });

  it('returns UPC_UCI when both UCI and UTI criteria are marked (UCI takes precedence)', () => {
    expect(
      resolveUpcClassification({
        uciCriteria: ['uci_vasoactivos'],
        utiCriteria: ['uti_mon_cardiaca', 'uti_materno_fetal'],
      })
    ).toBe('UPC_UCI');
  });

  it('works with Set inputs', () => {
    expect(
      resolveUpcClassification({
        uciCriteria: new Set<string>(),
        utiCriteria: new Set(['uti_infusion_alto_riesgo']),
      })
    ).toBe('UPC_UTI');
  });

  it('returns UPC_UTI with multiple UTI criteria', () => {
    expect(
      resolveUpcClassification({
        uciCriteria: [],
        utiCriteria: ['uti_mon_cardiaca', 'uti_mon_cardiaca', 'uti_materno_fetal'],
      })
    ).toBe('UPC_UTI');
  });
});

describe('resolveUpcClassificationLabel', () => {
  it('returns UCI for UPC_UCI', () => {
    expect(resolveUpcClassificationLabel('UPC_UCI')).toBe('UCI');
  });

  it('returns UTI for UPC_UTI', () => {
    expect(resolveUpcClassificationLabel('UPC_UTI')).toBe('UTI');
  });

  it('returns empty string for null', () => {
    expect(resolveUpcClassificationLabel(null)).toBe('');
  });
});
