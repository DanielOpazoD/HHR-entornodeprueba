// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildFieldShrinkageBlockedPartialUpdateResult,
  buildMissingBasePartialUpdateResult,
  buildValidationBlockedPartialUpdateResult,
} from '@/services/repositories/dailyRecordPartialUpdateBlockingController';
import { createRemoteWriteState } from '@/services/repositories/dailyRecordWriteState';

describe('dailyRecordPartialUpdateBlockingController', () => {
  it('builds the canonical blocked result when no base record can be found', () => {
    const state = createRemoteWriteState();

    const result = buildMissingBasePartialUpdateResult({
      date: '2026-05-28',
      state,
    });

    expect(result).toMatchObject({
      date: '2026-05-28',
      savedHere: false,
      state: 'not_saved',
      reason: 'blocked',
      userSafeMessage: 'No se encontró un registro local válido para aplicar el cambio.',
    });
    expect(state.conflictSummary).toMatchObject({
      kind: 'remote_missing',
      sourceOfTruth: 'none',
    });
    expect(state.observabilityTags).toEqual(['daily_record', 'write', 'missing_local_record']);
  });

  it('builds the canonical blocked result for validation failures', () => {
    const state = createRemoteWriteState();
    const error = new Error('Ingreso fuera de ventana clínica');

    const result = buildValidationBlockedPartialUpdateResult({
      date: '2026-05-28',
      state,
      changedPaths: ['beds.R1.admissionDate'],
      error,
    });

    expect(result).toMatchObject({
      savedHere: false,
      state: 'not_saved',
      reason: 'blocked',
      userSafeMessage: 'Ingreso fuera de ventana clínica',
      blockingError: error,
    });
    expect(state.conflictSummary).toMatchObject({
      kind: 'validation_blocked',
      sourceOfTruth: 'none',
      changedPaths: ['beds.R1.admissionDate'],
      message: 'Ingreso fuera de ventana clínica',
    });
    expect(state.observabilityTags).toEqual(['daily_record', 'write', 'validation_blocked']);
  });

  it('builds the canonical blocked result for suspicious clinical text shrinkage', () => {
    const state = createRemoteWriteState();

    const result = buildFieldShrinkageBlockedPartialUpdateResult({
      date: '2026-05-28',
      state,
      shrinkages: [
        { path: 'beds.R1.pathology', prevLength: 100, nextLength: 25 },
        { path: 'beds.R1.medicalHandoffNote', prevLength: 80, nextLength: 10 },
      ],
    });

    expect(result).toMatchObject({ savedHere: false, state: 'not_saved', reason: 'blocked' });
    expect(result.blockingError?.name).toBe('DataRegressionError');
    expect(result.userSafeMessage).toContain('100 -> 25');
    expect(state.conflictSummary).toMatchObject({
      kind: 'regression_blocked',
      sourceOfTruth: 'none',
      changedPaths: ['beds.R1.pathology', 'beds.R1.medicalHandoffNote'],
    });
    expect(state.observabilityTags).toEqual(['daily_record', 'write', 'field_shrinkage_blocked']);
  });
});
