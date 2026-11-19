// @vitest-environment node
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConcurrencyRemoteWriteRecovery } from '@/services/repositories/dailyRecordWriteConcurrencyRecoveryController';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  FIELD_CHANGED_ELSEWHERE_MESSAGE,
  createFieldChangedElsewhereError,
} from '@/services/storage/syncErrorCatalog';

vi.mock('@/services/repositories/dailyRecordConflictAutoMergeController', () => ({
  attemptConflictAutoMergeRecovery: vi.fn(),
}));

import { attemptConflictAutoMergeRecovery } from '@/services/repositories/dailyRecordConflictAutoMergeController';

const buildRecord = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-04-15T10:00:00.000Z',
    nurses: [],
    activeExtraBeds: [],
  }) as DailyRecord;

/** A direct send stored here whose remote step met another writer's change. */
const storedHere: DailyRecordWriteResult = {
  date: '2026-04-15',
  savedHere: true,
  state: 'local',
  cause: 'stored',
};

const recover = (error: unknown, changedPaths: string[], allowAutoMerge?: boolean) =>
  resolveConcurrencyRemoteWriteRecovery(
    '2026-04-15',
    buildRecord('2026-04-15'),
    changedPaths,
    error,
    storedHere,
    captureAuthoringSession(),
    allowAutoMerge
  );

describe('dailyRecordWriteConcurrencyRecoveryController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves a merged write to the queue, marked as a conflict', async () => {
    vi.mocked(attemptConflictAutoMergeRecovery).mockResolvedValueOnce({ status: 'auto_merged' });

    const step = await recover(new Error('Concurrency conflict'), ['*']);

    // A real merge integrated the other device's change: nothing is held.
    expect(step).toEqual({
      next: 'return',
      result: expect.objectContaining({
        savedHere: true,
        state: 'local',
        cause: 'merged',
        concurrencyConflict: true,
        userSafeMessage: 'Se resolvió un conflicto remoto mediante fusión automática.',
        blockingError: undefined,
      }),
    });
  });

  it('holds the edit with its reason when another device changed the same field', async () => {
    const error = createFieldChangedElsewhereError();
    vi.mocked(attemptConflictAutoMergeRecovery).mockResolvedValueOnce({ status: 'auto_merged' });

    const step = await recover(error, ['handoffNovedadesNightShift']);

    expect(step).toEqual({
      next: 'return',
      result: expect.objectContaining({
        state: 'held',
        reason: 'field_changed_elsewhere',
        concurrencyConflict: true,
        userSafeMessage: FIELD_CHANGED_ELSEWHERE_MESSAGE,
      }),
    });
    // The refusal travels to the queue so the task is stored held, not resent.
    expect(attemptConflictAutoMergeRecovery).toHaveBeenCalledWith(
      '2026-04-15',
      expect.anything(),
      ['handoffNovedadesNightShift'],
      expect.anything(),
      error
    );
  });

  it('holds the write for review with its own error when merge is not possible', async () => {
    const error = new Error('Concurrency conflict');
    vi.mocked(attemptConflictAutoMergeRecovery).mockResolvedValueOnce({ status: 'not_possible' });

    const step = await recover(error, ['beds.R1.patientName']);

    expect(step).toEqual({
      next: 'return',
      result: expect.objectContaining({
        state: 'held',
        reason: 'needs_review',
        concurrencyConflict: true,
        blockingError: error,
        userSafeMessage: 'Se detectó un conflicto remoto que requiere revisión manual.',
      }),
    });
  });

  it('never auto-merges a stale movement reclassification', async () => {
    const error = new Error('Concurrent reclassification');

    const step = await recover(error, ['discharges', 'cma'], false);

    expect(step).toEqual({
      next: 'return',
      result: expect.objectContaining({
        state: 'held',
        reason: 'needs_review',
        concurrencyConflict: true,
        blockingError: error,
        userSafeMessage:
          'El egreso fue modificado por otro usuario. Recarga el censo antes de reclasificarlo.',
      }),
    });
    expect(attemptConflictAutoMergeRecovery).not.toHaveBeenCalled();
  });
});
