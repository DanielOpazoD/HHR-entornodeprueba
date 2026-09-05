import { describe, it, expect } from 'vitest';
import {
  UPC_UCI_CRITERIA,
  UPC_UTI_CRITERIA,
  isValidUciCriterionId,
  isValidUtiCriterionId,
  sanitizeCriterionIds,
  normalizeUciCriterionId,
} from '@/domain/upc/upcCriteria';

describe('UPC criteria constants', () => {
  it('defines 2 UCI choices with vasoactive and inotrope support combined', () => {
    expect(UPC_UCI_CRITERIA).toHaveLength(2);
    expect(UPC_UCI_CRITERIA[1]).toEqual({
      id: 'uci_vasoactivos',
      label: 'Drogas vasopresoras o inotrópicas en infusión continua',
    });
  });
  it('uses the requested inclusive respiratory oxygen threshold', () => {
    expect(UPC_UTI_CRITERIA.find(c => c.id === 'uti_mon_respiratoria')?.label).toContain(
      'FiO₂ ≥ 50%'
    );
  });
  it('normalizes the historical inotrope ID without losing its meaning', () => {
    expect(normalizeUciCriterionId('uci_inotropicos')).toBe('uci_vasoactivos');
    expect(normalizeUciCriterionId('uci_vmi')).toBe('uci_vmi');
  });

  it('defines exactly 6 UTI criteria', () => {
    expect(UPC_UTI_CRITERIA).toHaveLength(6);
  });

  it('has unique IDs across all criteria', () => {
    const allIds = [...UPC_UCI_CRITERIA, ...UPC_UTI_CRITERIA].map(c => c.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('UCI IDs start with uci_ prefix', () => {
    UPC_UCI_CRITERIA.forEach(c => expect(c.id).toMatch(/^uci_/));
  });

  it('UTI IDs start with uti_ prefix', () => {
    UPC_UTI_CRITERIA.forEach(c => expect(c.id).toMatch(/^uti_/));
  });
});

describe('isValidUciCriterionId', () => {
  it('accepts valid UCI IDs', () => {
    expect(isValidUciCriterionId('uci_vmi')).toBe(true);
    expect(isValidUciCriterionId('uci_vasoactivos')).toBe(true);
    expect(isValidUciCriterionId('uci_inotropicos')).toBe(true);
  });

  it('rejects UTI IDs', () => {
    expect(isValidUciCriterionId('uti_mon_cardiaca')).toBe(false);
  });

  it('rejects arbitrary strings', () => {
    expect(isValidUciCriterionId('')).toBe(false);
    expect(isValidUciCriterionId('invalid')).toBe(false);
    expect(isValidUciCriterionId('uci_nonexistent')).toBe(false);
  });
});

describe('isValidUtiCriterionId', () => {
  it('accepts valid UTI IDs', () => {
    expect(isValidUtiCriterionId('uti_mon_cardiaca')).toBe(true);
    expect(isValidUtiCriterionId('uti_infusion_alto_riesgo')).toBe(true);
    expect(isValidUtiCriterionId('uti_materno_fetal')).toBe(true);
  });

  it('rejects UCI IDs', () => {
    expect(isValidUtiCriterionId('uci_vmi')).toBe(false);
  });

  it('rejects arbitrary strings', () => {
    expect(isValidUtiCriterionId('')).toBe(false);
    expect(isValidUtiCriterionId('uti_nonexistent')).toBe(false);
  });
});

describe('sanitizeCriterionIds', () => {
  it('returns empty array for null/undefined input', () => {
    expect(sanitizeCriterionIds(null, isValidUciCriterionId)).toEqual([]);
    expect(sanitizeCriterionIds(undefined, isValidUciCriterionId)).toEqual([]);
  });

  it('keeps only valid IDs', () => {
    const ids = ['uci_vmi', 'stale_old_id', 'uci_vasoactivos', ''];
    expect(sanitizeCriterionIds(ids, isValidUciCriterionId)).toEqual([
      'uci_vmi',
      'uci_vasoactivos',
    ]);
  });

  it('returns empty array when all IDs are invalid', () => {
    expect(sanitizeCriterionIds(['bad', 'also_bad'], isValidUtiCriterionId)).toEqual([]);
  });

  it('passes through all valid IDs unchanged', () => {
    const validIds = ['uti_mon_cardiaca', 'uti_materno_fetal'];
    expect(sanitizeCriterionIds(validIds, isValidUtiCriterionId)).toEqual(validIds);
  });
});
