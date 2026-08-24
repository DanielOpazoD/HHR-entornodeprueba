import { describe, expect, it } from 'vitest';
import {
  assertRayenCensusPersistenceConfirmed,
  isConfirmedRayenCensusHandoff,
  markRayenHistoricalCorrectionsRequireFreshCapture,
  markRayenHistoricalCorrectionsPending,
  resolveConfirmedRayenCensusHandoff,
  resolveStructuralStageResult,
} from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';

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

const buildRecord = (runId = 'run-1', overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date: '2026-07-28',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-07-28T10:00:00.000Z',
    activeExtraBeds: [],
    rayenSync: {
      at: '2026-07-28T10:00:00.000Z',
      by: 'Operador HHR',
      runId,
      status: 'applied',
    },
    rayenSyncHistory: [
      {
        id: runId,
        sourceDate: '2026-07-28',
        startedAt: '2026-07-28T09:59:00.000Z',
        completedAt: '2026-07-28T10:00:00.000Z',
        by: 'Operador HHR',
        status: 'applied',
        policy: { mode: 'preview', revision: 1, clinicalBatchMode: 'enforced' },
      },
    ],
    ...overrides,
  }) as DailyRecord;

describe('rayenCensusPersistenceGuard', () => {
  it('stops enrichment when the persistence adapter returns no confirmation', () => {
    expect(() =>
      assertRayenCensusPersistenceConfirmed({ record: buildRecord(), result: null })
    ).toThrow(/no se pudo confirmar el resultado del guardado/i);
  });

  it('allows clinical enrichment after a clean census write', () => {
    expect(() =>
      assertRayenCensusPersistenceConfirmed({ record: buildRecord(), result: buildResult() })
    ).not.toThrow();
  });

  it('preserves the authoritative brand while marking pending historical corrections', () => {
    const record = buildRecord();
    const handoff = resolveConfirmedRayenCensusHandoff(
      { record, result: buildResult() },
      { date: record.date, runId: 'run-1' }
    );

    const marked = markRayenHistoricalCorrectionsPending(handoff);

    expect(isConfirmedRayenCensusHandoff(marked)).toBe(true);
    expect(marked.historicalCorrectionsPending).toBe(true);
    expect(marked.acceptedRevision).toBe(handoff.acceptedRevision);
  });

  it('preserves the authoritative brand while requiring fresh historical evidence', () => {
    const record = buildRecord();
    const handoff = resolveConfirmedRayenCensusHandoff(
      { record, result: buildResult() },
      { date: record.date, runId: 'run-1' }
    );

    const marked = markRayenHistoricalCorrectionsRequireFreshCapture(handoff);

    expect(isConfirmedRayenCensusHandoff(marked)).toBe(true);
    expect(marked.historicalCorrectionsRequireFreshCapture).toBe(true);
    expect(marked.acceptedRevision).toBe(handoff.acceptedRevision);
  });

  it('allows a clean local-only write when remote persistence is intentionally disabled', () => {
    expect(() =>
      assertRayenCensusPersistenceConfirmed({
        record: buildRecord(),
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
          record: buildRecord(),
          result: buildResult({
            outcome,
            savedRemotely: false,
            queuedForRetry: true,
            autoMerged: outcome === 'auto_merged',
            consistencyState: outcome === 'auto_merged' ? 'auto_merged' : 'queued_for_retry',
            sourceOfTruth: 'local',
          }),
        })
      ).toThrow(/pendiente de confirmación en la nube/i);
    }
  );

  it('does not misclassify an operationally queued write as a concurrency conflict', () => {
    let thrown: unknown;
    try {
      assertRayenCensusPersistenceConfirmed({
        record: buildRecord(),
        result: buildResult({
          outcome: 'queued',
          savedRemotely: false,
          queuedForRetry: true,
          consistencyState: 'queued_for_retry',
          sourceOfTruth: 'local',
        }),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ name: 'Error' });
    expect(thrown).not.toMatchObject({ name: 'ConcurrencyError' });
  });

  it('marks an explicit concurrency outcome as a recoverable concurrency conflict', () => {
    try {
      assertRayenCensusPersistenceConfirmed({
        record: buildRecord(),
        result: buildResult({
          outcome: 'auto_merged',
          savedRemotely: false,
          queuedForRetry: true,
          autoMerged: true,
          consistencyState: 'auto_merged',
          sourceOfTruth: 'local',
          conflictSummary: {
            kind: 'concurrency',
            sourceOfTruth: 'local',
            message: 'La versión remota cambió durante el guardado.',
          },
        }),
      });
      throw new Error('Expected persistence guard to reject the stale census');
    } catch (error) {
      expect(error).toMatchObject({ name: 'ConcurrencyError' });
    }
  });

  it('surfaces unrecoverable local persistence instead of continuing', () => {
    expect(() =>
      assertRayenCensusPersistenceConfirmed({
        record: buildRecord(),
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

  it('hands the exact confirmed census to clinical enrichment', () => {
    const record = buildRecord();

    const handoff = resolveConfirmedRayenCensusHandoff(
      { record, result: buildResult() },
      { date: record.date, runId: 'run-1' }
    );

    expect(handoff.record).toBe(record);
    expect(handoff.runId).toBe('run-1');
    expect(handoff.selectedDate).toBe('2026-07-28');
    expect(handoff.clinicalDay).toBe('2026-07-28');
    expect(handoff.acceptedRevision).toBe(record.lastUpdated);
    expect(isConfirmedRayenCensusHandoff(handoff)).toBe(true);
    expect(isConfirmedRayenCensusHandoff(record)).toBe(false);
  });

  it('carries non-blocking historical admission traceability into the confirmed handoff', () => {
    const record = buildRecord();

    const handoff = resolveConfirmedRayenCensusHandoff(
      { record, result: buildResult() },
      {
        date: record.date,
        runId: 'run-1',
        diff: {
          conflicts: [],
          deferredHistoricalAdmissionBedIds: ['H5C2', 'H5C2'],
        },
      }
    );

    expect(handoff.deferredHistoricalAdmissionBedIds).toEqual(['H5C2']);
    expect(resolveStructuralStageResult(handoff)).toMatchObject({ status: 'confirmed' });
  });

  it('accepts an already applied census when a previous clinical attempt marked its audit failed', () => {
    const record = buildRecord('run-1', {
      lastUpdated: '2026-07-28T10:05:00.000Z',
      rayenSyncHistory: [
        {
          id: 'run-1',
          sourceDate: '2026-07-28',
          startedAt: '2026-07-28T09:59:00.000Z',
          completedAt: '2026-07-28T10:04:00.000Z',
          by: 'Operador HHR',
          status: 'failed',
          failureReason: 'apply_failed',
          policy: { mode: 'preview', revision: 1, clinicalBatchMode: 'enforced' },
        },
      ],
    });

    const handoff = resolveConfirmedRayenCensusHandoff(
      { record, result: buildResult({ confirmedRecord: record }) },
      { date: record.date, runId: 'run-1' }
    );

    expect(handoff.acceptedRevision).toBe('2026-07-28T10:05:00.000Z');
    expect(handoff.record).toBe(record);
  });

  it('isolates one conflicting episode and lets confirmed episodes continue to clinical fill', () => {
    const record = buildRecord('run-1', {
      beds: {
        H1C1: {
          bedId: 'H1C1',
          patientName: 'Paciente seguro',
          clinicalEpisodeId: 'episode-safe',
        },
        H2C1: {
          bedId: 'H2C1',
          patientName: 'Paciente en conflicto',
          clinicalEpisodeId: 'episode-blocked',
        },
      } as unknown as DailyRecord['beds'],
    });
    const diff = {
      conflicts: [
        {
          bedId: 'H2C1',
          reason: 'La cama requiere revisión.',
          source: { encounterId: 'episode-blocked' },
        },
      ],
    } as CensusImportDiff;

    const handoff = resolveConfirmedRayenCensusHandoff(
      { record, result: buildResult() },
      { date: record.date, clinicalDay: '2026-07-27', runId: 'run-1', diff }
    );

    expect(handoff.clinicalDay).toBe('2026-07-27');
    expect(handoff.safeClinicalEpisodeIds).toEqual(['episode-safe']);
    expect(resolveStructuralStageResult(handoff)).toMatchObject({
      status: 'confirmed_with_conflicts',
      handoff,
    });
  });

  it('isolates the persisted occupant when a conflict names a different incoming episode', () => {
    const record = buildRecord('run-1', {
      beds: {
        H1C1: {
          bedId: 'H1C1',
          patientName: 'Paciente seguro',
          clinicalEpisodeId: 'episode-safe',
        },
        H2C1: {
          bedId: 'H2C1',
          patientName: 'Ocupante de cama disputada',
          clinicalEpisodeId: 'episode-occupant',
        },
      } as unknown as DailyRecord['beds'],
    });
    const diff = {
      conflicts: [
        {
          bedId: 'H2C1',
          reason: 'Otro episodio intenta ocupar una cama vigente.',
          source: { encounterId: 'episode-incoming' },
        },
      ],
    } as CensusImportDiff;

    const handoff = resolveConfirmedRayenCensusHandoff(
      { record, result: buildResult() },
      { date: record.date, runId: 'run-1', diff }
    );

    expect(handoff.safeClinicalEpisodeIds).toEqual(['episode-safe']);
    expect(handoff.isolatedConflicts).toEqual([
      expect.objectContaining({
        bedId: 'H2C1',
        clinicalEpisodeId: 'episode-incoming',
      }),
    ]);
  });

  it('blocks clinical fill when an unresolved bed conflict leaves no safe episode', () => {
    const record = buildRecord('run-1', {
      beds: {
        H2C1: {
          bedId: 'H2C1',
          patientName: 'Paciente en conflicto',
          clinicalEpisodeId: 'episode-blocked',
        },
      } as unknown as DailyRecord['beds'],
    });
    const diff = {
      conflicts: [{ bedId: 'H2C1', reason: 'Identidad ambigua en la cama.' }],
    } as CensusImportDiff;

    const handoff = resolveConfirmedRayenCensusHandoff(
      { record, result: buildResult() },
      { date: record.date, runId: 'run-1', diff }
    );

    expect(handoff.safeClinicalEpisodeIds).toEqual([]);
    expect(resolveStructuralStageResult(handoff)).toEqual({
      status: 'blocked',
      reasons: handoff.isolatedConflicts,
    });
  });

  it('blocks every episode when a structural conflict has no isolatable scope', () => {
    const record = buildRecord('run-1', {
      beds: {
        H1C1: {
          bedId: 'H1C1',
          patientName: 'Paciente seguro en apariencia',
          clinicalEpisodeId: 'episode-unknown-scope',
        },
      } as unknown as DailyRecord['beds'],
    });
    const diff = {
      conflicts: [{ bedId: null, reason: 'La evidencia no identifica una cama ni episodio.' }],
    } as CensusImportDiff;

    const handoff = resolveConfirmedRayenCensusHandoff(
      { record, result: buildResult() },
      { date: record.date, runId: 'run-1', diff }
    );

    expect(handoff.safeClinicalEpisodeIds).toEqual([]);
    expect(resolveStructuralStageResult(handoff)).toEqual({
      status: 'blocked',
      reasons: handoff.isolatedConflicts,
    });
  });

  it.each([
    ['another day', buildRecord('run-1', { date: '2026-07-29' })],
    ['another run', buildRecord('run-2')],
    [
      'a run without an applied event',
      buildRecord('run-1', {
        rayenSyncHistory: [
          {
            id: 'run-1',
            sourceDate: '2026-07-28',
            startedAt: '2026-07-28T09:59:00.000Z',
            by: 'Operador HHR',
            status: 'partial',
            policy: { mode: 'preview', revision: 1, clinicalBatchMode: 'enforced' },
          },
        ],
      }),
    ],
  ])('rejects a clean write that confirms %s', (_label, record) => {
    expect(() =>
      resolveConfirmedRayenCensusHandoff(
        { record, result: buildResult() },
        { date: '2026-07-28', runId: 'run-1' }
      )
    ).toThrow(/no confirmó la versión de esta sincronización/i);
  });

  it('rejects a clean acknowledgment issued for another census day', () => {
    expect(() =>
      resolveConfirmedRayenCensusHandoff(
        {
          record: buildRecord(),
          result: buildResult({ date: '2026-07-29' }),
        },
        { date: '2026-07-28', runId: 'run-1' }
      )
    ).toThrow(/no confirmó la versión de esta sincronización/i);
  });
});
