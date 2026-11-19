// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildFieldShrinkageBlockedPartialUpdateResult,
  buildMissingBasePartialUpdateResult,
} from '@/services/repositories/dailyRecordPartialUpdateBlockingController';

describe('dailyRecordPartialUpdateBlockingController', () => {
  it('builds the canonical blocked result when no base record can be found', () => {
    expect(buildMissingBasePartialUpdateResult('2026-05-28')).toEqual({
      date: '2026-05-28',
      savedHere: false,
      state: 'not_saved',
      reason: 'blocked',
      userSafeMessage: 'No se encontró un registro local válido para aplicar el cambio.',
      blockingError: undefined,
    });
  });

  it('builds the canonical blocked result for suspicious clinical text shrinkage', () => {
    const result = buildFieldShrinkageBlockedPartialUpdateResult('2026-05-28', [
      { path: 'beds.R1.pathology', prevLength: 100, nextLength: 25 },
      { path: 'beds.R1.medicalHandoffNote', prevLength: 80, nextLength: 10 },
    ]);

    expect(result).toMatchObject({ savedHere: false, state: 'not_saved', reason: 'blocked' });
    expect(result.blockingError?.name).toBe('DataRegressionError');
    expect(result.userSafeMessage).toContain('100 -> 25');
    expect(result.blockingError?.message).toBe(result.userSafeMessage);
  });
});
