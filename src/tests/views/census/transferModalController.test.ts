import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSFER_ESCORT,
  EVACUATION_METHOD_AEROCARDAL,
  EVACUATION_METHOD_COMMERCIAL,
  EVACUATION_METHOD_OTHER,
  RECEIVING_CENTER_OTHER,
} from '@/constants';
import {
  buildTransferValidationErrors,
  hasTransferValidationErrors,
  resolveTransferInitialTime,
  resolveTransferMethodChangeEffects,
} from '@/features/census/controllers/transferModalController';

describe('transferModalController', () => {
  it('resolves transfer time preferring initial time', () => {
    expect(resolveTransferInitialTime('10:15', '12:00')).toBe('10:15');
    expect(resolveTransferInitialTime(' 10:15 ', '12:00')).toBe('10:15');
    expect(resolveTransferInitialTime('99:99', '12:00')).toBe('12:00');
    expect(resolveTransferInitialTime(undefined, '12:00')).toBe('12:00');
  });

  it('maps validation errors including escort error', () => {
    const errors = buildTransferValidationErrors({
      recordDate: '2024-12-11',
      movementDate: '2024-12-11',
      evacuationMethod: EVACUATION_METHOD_OTHER,
      evacuationMethodOther: '',
      receivingCenter: RECEIVING_CENTER_OTHER,
      receivingCenterOther: '',
      transferEscort: '',
      transferTime: '99:99',
    });

    expect(errors.time).toBeTypeOf('string');
    expect(errors.otherCenter).toBeTypeOf('string');
    expect(errors.otherEvacuation).toBeTypeOf('string');
    expect(errors.escort).toBeTypeOf('string');
    expect(hasTransferValidationErrors(errors)).toBe(true);
  });

  it('does not return escort error for Aerocardal even with empty escort', () => {
    const errors = buildTransferValidationErrors({
      recordDate: '2024-12-11',
      movementDate: '2024-12-11',
      evacuationMethod: EVACUATION_METHOD_AEROCARDAL,
      evacuationMethodOther: '',
      receivingCenter: RECEIVING_CENTER_OTHER,
      receivingCenterOther: 'Centro externo',
      transferEscort: '',
      transferTime: '10:00',
    });

    expect(errors.escort).toBeUndefined();
  });

  it('returns transfer method side effects for commercial and non-other method', () => {
    const commercialEffects = resolveTransferMethodChangeEffects({
      nextMethod: EVACUATION_METHOD_COMMERCIAL,
    });
    const fachEffects = resolveTransferMethodChangeEffects({
      nextMethod: 'Avión FACH',
    });

    expect(commercialEffects).toEqual({
      nextTransferEscort: DEFAULT_TRANSFER_ESCORT,
      shouldClearEvacuationMethodOther: true,
    });
    expect(fachEffects).toEqual({
      nextTransferEscort: undefined,
      shouldClearEvacuationMethodOther: true,
    });
  });
});
