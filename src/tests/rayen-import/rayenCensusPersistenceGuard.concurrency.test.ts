import { describe, expect, it } from 'vitest';
import { resolveConfirmedRayenCensusHandoff } from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import { classifyRayenApplyFailureReason } from '@/features/rayen-import/observability/rayenSyncDiagnostics';
import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';

/**
 * Sello de la corrida tras un guardado ACEPTADO (visto en vivo el 02-09 con dos
 * pestañas de HHR sobre el mismo censo): otra corrida más reciente gana y esta
 * cede; un sello ausente o de una corrida más antigua es un conflicto de
 * concurrencia que el lazo de replan reintenta.
 */

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

describe('rayenCensusPersistenceGuard · sello de la corrida tras un guardado aceptado', () => {
  it('rejects a clean write that confirms another day as a programming-level error (no retry)', () => {
    let thrown: unknown;
    try {
      resolveConfirmedRayenCensusHandoff(
        { record: buildRecord('run-1', { date: '2026-07-29' }), result: buildResult() },
        { date: '2026-07-28', runId: 'run-1' }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: 'Error' });
    expect(String((thrown as Error).message)).toMatch(
      /no confirmó la versión de esta sincronización/i
    );
  });

  it('otra corrida MÁS RECIENTE ya selló el censo: esta cede sin reintento (no la pisa) y se archiva como conflicto', () => {
    // Reintentar re-sellaría el puntero rayenSync con esta corrida y dejaría
    // superada la fase clínica de la otra pestaña, que fue la que ganó.
    const record = buildRecord('run-2'); // run-2 aplicada a las 09:59
    let thrown: unknown;
    try {
      resolveConfirmedRayenCensusHandoff(
        { record, result: buildResult() },
        { date: '2026-07-28', runId: 'run-1', startedAt: '2026-07-28T09:50:00.000Z' }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: 'RayenRunSupersededError' });
    expect(String((thrown as Error).message)).toMatch(/más reciente ya confirmó este censo/i);
    expect(classifyRayenApplyFailureReason(thrown)).toBe('apply_conflict');

    // Sin conocer el inicio de esta corrida, no se pisa a la otra: cede.
    let unknownStart: unknown;
    try {
      resolveConfirmedRayenCensusHandoff(
        { record, result: buildResult() },
        { date: '2026-07-28', runId: 'run-1' }
      );
    } catch (error) {
      unknownStart = error;
    }
    expect(unknownStart).toMatchObject({ name: 'RayenRunSupersededError' });
  });

  it.each([
    [
      'a stale stamp from an OLDER run',
      buildRecord('run-2'),
      '2026-07-28T10:30:00.000Z', // esta corrida es posterior a run-2 (09:59)
    ],
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
      '2026-07-28T09:59:00.000Z',
    ],
  ])(
    'un guardado aceptado cuyo sello no quedó en el servidor (%s) es un conflicto de concurrencia reintentable',
    (_label, record, startedAt) => {
      // Visto en vivo (02-09): dos pestañas de HHR sobre el mismo censo; otra
      // escritura pisó el sello y la corrida moría como apply_failed sin reintento.
      let thrown: unknown;
      try {
        resolveConfirmedRayenCensusHandoff(
          { record, result: buildResult() },
          { date: '2026-07-28', runId: 'run-1', startedAt }
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ name: 'ConcurrencyError' });
      expect(String((thrown as Error).message)).toMatch(/otra escritura cambió el censo/i);
      expect(classifyRayenApplyFailureReason(thrown)).toBe('apply_conflict');
    }
  );
});
