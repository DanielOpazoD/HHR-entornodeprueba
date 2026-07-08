import { describe, expect, it } from 'vitest';
import {
  isKnownSpecialtyValue,
  resolveSpecialtyCellState,
  resolveSpecialtyDisplayLabel,
} from '@/features/census/controllers/specialtyCellController';

describe('specialtyCellController', () => {
  it('resolves known specialty and primary custom state flags', () => {
    expect(isKnownSpecialtyValue('Medicina', ['Medicina', 'Cirugía'])).toBe(true);
    expect(isKnownSpecialtyValue('Custom', ['Medicina', 'Cirugía'])).toBe(false);

    expect(
      resolveSpecialtyCellState({
        specialty: 'Custom',
        availableSpecialties: ['Medicina', 'Cirugía'],
      })
    ).toEqual({
      isPrimaryOther: true,
    });
  });

  it('resolves specialty label with abbreviation fallback', () => {
    expect(resolveSpecialtyDisplayLabel('Medicina Interna', { 'Medicina Interna': 'MED' })).toBe(
      'MED'
    );
    expect(resolveSpecialtyDisplayLabel('Custom', { 'Medicina Interna': 'MED' })).toBe('Custom');
    expect(resolveSpecialtyDisplayLabel(undefined, {})).toBeUndefined();
  });
});
