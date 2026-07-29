import { describe, expect, it } from 'vitest';
import { assertRayenCensusPersistenceConfirmed } from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const buildResult = (overrides: Partial<SaveDailyRecordResult> = {}): SaveDailyRecordResult => ({
  date: '2026-07-28',
  outcome: 'clean',
  savedLocally: true,
  savedRemotely: true,
  queuedForRetry: false,
  autoMerged: false,
  consistencyState: 'persisted_and_synced',
  sourceOfTruth: 'remote',
  retryability: 'not_applicable',
  recoveryAction: 'none',
  conflictSummary: null,
  observabilityTags: ['daily_record', 'write'],
  repairApplied: false,
  ...overrides,
});

describe('rayenCensusPersistenceGuard', () => {
  it('stops enrichment when the persistence adapter returns no confirmation', () => {
    expect(() => assertRayenCensusPersistenceConfirmed({ result: null })).toThrow(
      /no se pudo confirmar el resultado del guardado/i
    );
  });

  it('allows clinical enrichment after a clean census write', () => {
    expect(() => assertRayenCensusPersistenceConfirmed({ result: buildResult() })).not.toThrow();
  });

  it('allows a clean local-only write when remote persistence is intentionally disabled', () => {
    expect(() =>
      assertRayenCensusPersistenceConfirmed({
        result: buildResult({
          savedRemotely: false,
          consistencyState: 'persisted_local_only',
          sourceOfTruth: 'local',
        }),
      })
    ).not.toThrow();
  });

  it.each(['queued', 'auto_merged'] as const)(
    'stops enrichment while structural outcome %s is still pending',
    outcome => {
      expect(() =>
        assertRayenCensusPersistenceConfirmed({
          result: buildResult({
            outcome,
            savedRemotely: false,
            queuedForRetry: true,
            autoMerged: outcome === 'auto_merged',
            consistencyState: outcome === 'auto_merged' ? 'auto_merged' : 'queued_for_retry',
            sourceOfTruth: 'local',
          }),
        })
      ).toThrow(/todavía no fue confirmado en la nube/i);
    }
  );

  it('surfaces unrecoverable local persistence instead of continuing', () => {
    expect(() =>
      assertRayenCensusPersistenceConfirmed({
        result: buildResult({
          outcome: 'unrecoverable',
          savedLocally: false,
          savedRemotely: false,
          consistencyState: 'unrecoverable',
          sourceOfTruth: 'none',
          userSafeMessage: 'No fue posible confirmar el guardado local.',
        }),
      })
    ).toThrow('No fue posible confirmar el guardado local.');
  });
});
