// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assertDailyRecordWriteAccepted,
  DailyRecordWriteBlockedOutcomeError,
} from '@/hooks/controllers/dailyRecordWriteOutcomeGuard';
import type {
  SaveDailyRecordResult,
  UpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';

const buildPatchResult = (
  overrides: Partial<UpdatePartialDailyRecordResult>
): UpdatePartialDailyRecordResult => ({
  date: '2026-02-18',
  outcome: 'clean',
  savedLocally: true,
  updatedRemotely: true,
  queuedForRetry: false,
  autoMerged: false,
  consistencyState: 'persisted_and_synced',
  conflictSummary: null,
  observabilityTags: ['daily_record', 'write'],
  ...overrides,
});

const buildSaveResult = (overrides: Partial<SaveDailyRecordResult>): SaveDailyRecordResult => ({
  date: '2026-02-18',
  outcome: 'clean',
  savedLocally: true,
  savedRemotely: true,
  queuedForRetry: false,
  autoMerged: false,
  consistencyState: 'persisted_and_synced',
  conflictSummary: null,
  observabilityTags: ['daily_record', 'write'],
  ...overrides,
});

describe('dailyRecordWriteOutcomeGuard', () => {
  it.each(['clean', 'queued', 'auto_merged'] as const)(
    'accepts patch result outcome %s',
    outcome => {
      expect(() => assertDailyRecordWriteAccepted(buildPatchResult({ outcome }))).not.toThrow();
    }
  );

  it('rejects a blocked outcome even when consistencyState is unrecoverable', () => {
    const result = buildPatchResult({
      outcome: 'blocked',
      savedLocally: false,
      updatedRemotely: false,
      consistencyState: 'unrecoverable',
      userSafeMessage: 'No se encontró un registro local válido para aplicar el cambio.',
    });

    expect(() => assertDailyRecordWriteAccepted(result)).toThrow(
      DailyRecordWriteBlockedOutcomeError
    );
  });

  it.each(['blocked_validation', 'blocked_regression', 'blocked_version_mismatch'] as const)(
    'rejects save result consistencyState %s',
    consistencyState => {
      const result = buildSaveResult({
        outcome: 'clean',
        consistencyState,
        userSafeMessage: 'Operación bloqueada por consistencia.',
      });

      expect(() => assertDailyRecordWriteAccepted(result)).toThrow(
        DailyRecordWriteBlockedOutcomeError
      );
    }
  );

  it('rejects an unrecoverable result instead of reporting a successful mutation', () => {
    const result = buildSaveResult({
      outcome: 'unrecoverable',
      savedLocally: false,
      savedRemotely: false,
      consistencyState: 'unrecoverable',
      userSafeMessage: 'La persistencia local no pudo confirmarse.',
    });

    expect(() => assertDailyRecordWriteAccepted(result)).toThrow(
      DailyRecordWriteBlockedOutcomeError
    );
  });
});
