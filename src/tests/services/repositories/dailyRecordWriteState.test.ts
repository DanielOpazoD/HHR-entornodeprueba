// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildBlockedPartialUpdateResult,
  buildBlockedSaveResult,
  createRemoteWriteState,
} from '@/services/repositories/dailyRecordWriteState';

describe('dailyRecordWriteState', () => {
  it('builds blocked save results from the remote write state', () => {
    const state = createRemoteWriteState();
    state.consistencyState = 'blocked_validation';
    state.retryability = 'blocked';
    state.recoveryAction = 'block_and_surface';
    state.conflictSummary = {
      kind: 'validation_blocked',
      sourceOfTruth: 'none',
      message: 'Regla clinica invalida',
    };
    state.observabilityTags = ['daily_record', 'write', 'validation_blocked'];
    state.userSafeMessage = 'Regla clinica invalida';
    state.blockingReason = 'validation';
    state.blockingError = new Error('Regla clinica invalida');

    const result = buildBlockedSaveResult('2026-04-16', state);

    expect(result.outcome).toBe('blocked');
    expect(result.savedLocally).toBe(false);
    expect(result.consistencyState).toBe('blocked_validation');
    expect(result.blockingReason).toBe('validation');
  });

  it('builds blocked partial update results from the remote write state', () => {
    const state = createRemoteWriteState();
    state.consistencyState = 'blocked_validation';
    state.retryability = 'blocked';
    state.recoveryAction = 'block_and_surface';
    state.observabilityTags = ['daily_record', 'write', 'validation_blocked'];
    state.userSafeMessage = 'No se puede cambiar la fecha de ingreso.';
    state.blockingReason = 'validation';

    const result = buildBlockedPartialUpdateResult('2026-04-16', state, 2);

    expect(result.outcome).toBe('blocked');
    expect(result.savedLocally).toBe(false);
    expect(result.updatedRemotely).toBe(false);
    expect(result.patchedFields).toBe(2);
    expect(result.blockingReason).toBe('validation');
  });
});
