import { describe, expect, it, vi } from 'vitest';
import {
  dispatchSpecialtyChange,
  isKnownSpecialtyValue,
  resolveDualSpecialtyCellState,
  resolveSpecialtyDisplayLabel,
} from '@/features/census/controllers/dualSpecialtyCellController';

describe('dualSpecialtyCellController', () => {
  it('resolves known specialty and dual state flags', () => {
    expect(isKnownSpecialtyValue('Medicina', ['Medicina', 'Cirugía'])).toBe(true);
    expect(isKnownSpecialtyValue('Custom', ['Medicina', 'Cirugía'])).toBe(false);

    expect(
      resolveDualSpecialtyCellState({
        specialty: 'Custom',
        secondarySpecialty: 'Cirugía',
        availableSpecialties: ['Medicina', 'Cirugía'],
      })
    ).toEqual({
      hasSecondary: true,
      isPrimaryOther: true,
      isSecondaryOther: false,
    });
  });

  it('resolves specialty label with abbreviation fallback', () => {
    expect(resolveSpecialtyDisplayLabel('Medicina Interna', { 'Medicina Interna': 'MED' })).toBe(
      'MED'
    );
    expect(resolveSpecialtyDisplayLabel('Custom', { 'Medicina Interna': 'MED' })).toBe('Custom');
    expect(resolveSpecialtyDisplayLabel(undefined, {})).toBeUndefined();
  });

  it('dispatches synthetic specialty change event', () => {
    const fieldHandler = vi.fn();
    const onChange = vi.fn().mockReturnValue(fieldHandler);

    dispatchSpecialtyChange({
      onChange,
      field: 'secondarySpecialty',
      value: undefined,
    });

    expect(onChange).toHaveBeenCalledWith('secondarySpecialty');
    expect(fieldHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ value: undefined }),
      })
    );
  });
});
