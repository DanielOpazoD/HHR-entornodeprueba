import { describe, expect, it } from 'vitest';
import { DEFAULT_DISCHARGE_TYPE } from '@/constants';
import {
  buildDischargeConfirmPayload,
  buildInitialDischargeFormState,
  hasDischargeValidationErrors,
  mapDischargeValidationErrors,
  shouldShowBabyStatus,
  shouldShowMotherStatus,
} from '@/features/census/controllers/dischargeModalController';

describe('dischargeModalController', () => {
  it('builds initial state with defaults when no initial data exists', () => {
    const state = buildInitialDischargeFormState({
      recordDate: '2024-12-11',
      defaultTime: '12:00',
      dischargeTarget: 'both',
    });

    expect(state).toEqual({
      dischargeType: DEFAULT_DISCHARGE_TYPE,
      otherDetails: '',
      movementDate: '2024-12-11',
      dischargeTime: '12:00',
      localTarget: 'both',
    });
  });

  it('uses default time when initial discharge time is invalid', () => {
    const state = buildInitialDischargeFormState({
      recordDate: '2024-12-11',
      initialTime: '24:70',
      defaultTime: '12:00',
      dischargeTarget: 'both',
    });

    expect(state.dischargeTime).toBe('12:00');
  });

  it('maps discharge validation errors for time and typeOther', () => {
    const errors = mapDischargeValidationErrors('Vivo', 'Otra', '', '99:99');

    expect(errors.time).toBeTypeOf('string');
    expect(errors.other).toBeTypeOf('string');
    expect(hasDischargeValidationErrors(errors)).toBe(true);
  });

  it('builds payload with typeOther only when discharge type is Otra', () => {
    const payload = buildDischargeConfirmPayload({
      status: 'Vivo',
      dischargeType: 'Otra',
      otherDetails: 'Derivación especial',
      dischargeTime: '10:30',
      hasClinicalCrib: true,
      localTarget: 'baby',
    });

    expect(payload).toEqual({
      status: 'Vivo',
      type: 'Otra',
      typeOther: 'Derivación especial',
      time: '10:30',
      movementDate: undefined,
      dischargeTarget: 'baby',
    });
  });

  it('omits type/typeOther and dischargeTarget when not applicable', () => {
    const payload = buildDischargeConfirmPayload({
      status: 'Fallecido',
      dischargeType: 'Domicilio (Habitual)',
      otherDetails: '',
      dischargeTime: '08:00',
      hasClinicalCrib: false,
      localTarget: 'both',
    });

    expect(payload).toEqual({
      status: 'Fallecido',
      type: undefined,
      typeOther: undefined,
      time: '08:00',
      movementDate: undefined,
      dischargeTarget: undefined,
    });
  });

  it('resolves visibility helpers for mother and baby sections', () => {
    expect(shouldShowMotherStatus('mother')).toBe(true);
    expect(shouldShowMotherStatus('both')).toBe(true);
    expect(shouldShowMotherStatus('baby')).toBe(false);

    expect(shouldShowBabyStatus('baby', true)).toBe(true);
    expect(shouldShowBabyStatus('both', true)).toBe(true);
    expect(shouldShowBabyStatus('baby', false)).toBe(false);
  });
});
