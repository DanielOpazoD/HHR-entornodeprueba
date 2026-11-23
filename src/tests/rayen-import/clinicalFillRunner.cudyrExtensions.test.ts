// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from './support/batchClinicalFill';
import type { RayenCudyrCategoriesResponse } from '@/features/rayen-import/contracts/rayenCudyr';
import { resolveHistoricalCudyrBatchOperation } from '@/features/rayen-import/domain/historicalCudyrPatch';
import { buildImportedCudyr } from '@/domain/evaluationScales/importedCudyr';
import { createEmptyPatient } from '@/domain/patient/patientFactory';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { applyPatches } from '@/utils/patchUtils';
import { DataFactory } from '@/tests/factories/DataFactory';

const singleRecord = (date = '2026-07-10', patientName = 'Paciente'): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    beds: {
      H1C2: {
        ...createEmptyPatient('H1C2'),
        patientName,
        clinicalEpisodeId: 'E1',
        devices: [],
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
  });

const singleDeps = (over: Partial<ClinicalFillDeps> = {}): ClinicalFillDeps => ({
  fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
  extractDeviceItems: vi.fn().mockResolvedValue([]),
  fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
  fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
  fetchCudyrCategories: vi.fn().mockResolvedValue({
    items: [],
    source: 'gestion_camas',
    historyAvailable: true,
  }),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  now: () => new Date('2026-07-10T12:00:00.000Z'),
  createId: () => 'id-1',
  ...over,
});

describe('current CUDYR administrative authority', () => {
  it.each([
    {
      label: 'Eloísa reports a different value',
      items: [
        {
          encId: 'E1',
          crdValue: 'C2',
          crdDateTime: '2026-07-10T18:00:00+00:00',
          source: 'gestion_camas' as const,
        },
      ],
    },
    { label: 'Eloísa reports no value', items: [] },
  ])('preserves an administrative adjustment when $label', async ({ items }) => {
    const current = singleRecord();
    (current.beds.H1C2 as { evaluationScores?: unknown }).evaluationScores = {
      braden: { total: 17 },
      downton: { total: 2 },
      cudyr: {
        category: 'D2',
        recordedDate: '2026-07-10',
        source: 'HHR · ajuste administrativo',
      },
    };
    const input = singleDeps({
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items,
        source: 'gestion_camas',
        historyAvailable: true,
      }),
    });

    const summary = await runClinicalFill(current, '2026-07-10', input);

    expect(summary.errors).toEqual([]);
    expect(summary.performance?.counters.administrativeOverridesPreserved).toBe(1);
    const patch = (input.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch['beds.H1C2.evaluationScores'].cudyr).toEqual({
      category: 'D2',
      recordedDate: '2026-07-10',
      source: 'HHR · ajuste administrativo',
    });
    expect(current.beds.H1C2.evaluationScores).toMatchObject({
      braden: { total: 17 },
      downton: { total: 2 },
      cudyr: { category: 'D2', source: 'HHR · ajuste administrativo' },
    });
  });

  it('continues updating a normal value imported from Eloísa', async () => {
    const current = singleRecord();
    (current.beds.H1C2 as { evaluationScores?: unknown }).evaluationScores = {
      cudyr: {
        category: 'B1',
        recordedDate: '2026-07-10',
        source: 'Eloísa · Gestión de Camas',
      },
    };
    const input = singleDeps({
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          {
            encId: 'E1',
            crdValue: 'C2',
            crdDateTime: '2026-07-10T18:00:00+00:00',
            source: 'gestion_camas',
          },
        ],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
    });

    const summary = await runClinicalFill(current, '2026-07-10', input);

    expect(summary.errors).toEqual([]);
    expect(summary.performance?.counters.administrativeOverridesPreserved).toBeUndefined();
    const patch = (input.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch['beds.H1C2.evaluationScores']).toMatchObject({
      cudyr: { category: 'C2', source: 'Eloísa · Gestión de Camas' },
    });
  });
});

describe('CUDYR synchronization after the episode leaves current beds', () => {
  const episode = 'synthetic-discharged-episode';
  const row = {
    encId: episode,
    source: 'gestion_camas' as const,
    crdValue: 'C2',
    crdDateTime: '2026-10-27T03:00:00-05:00',
  };
  const stored = buildImportedCudyr(row, '2026-10-26');
  const response = (): RayenCudyrCategoriesResponse => ({
    items: [],
    source: 'gestion_camas',
    historyAvailable: true,
    observedEpisodeIds: [],
    metadataStatus: 'complete',
  });
  const census = (date = '2026-10-26') => ({
    ...buildInitializedDayRecord(date, null),
    beds: {
      R1: {
        ...createEmptyPatient('R1'),
        patientName: 'Paciente sintético',
        clinicalEpisodeId: episode,
        evaluationScores: { ...(stored ? { cudyr: stored } : {}) },
      },
    },
  });
  const dependencies = (source = response()) => ({
    fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
    extractDeviceItems: vi.fn().mockResolvedValue([]),
    fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
    fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
    fetchCudyrCategories: vi.fn().mockResolvedValue(source),
    applyPatch: vi.fn<ClinicalFillDeps['applyPatch']>().mockResolvedValue(undefined),
    applyHistoricalCudyr: vi.fn().mockResolvedValue({ persisted: true, changed: true }),
    archiveCudyrCapture: vi.fn().mockResolvedValue('persisted'),
    diagnosticRunId: 'synthetic-late-sync',
    now: () => new Date('2026-10-27T20:00:00-05:00'),
    createId: () => '00000000-0000-4000-8000-000000000026',
  });

  it.each(['missing', 'other-episode'])(
    'preserves the accepted night result with a %s source row',
    async kind => {
      const source = response();
      if (kind === 'other-episode') source.items = [{ ...row, encId: 'synthetic-new-episode' }];
      const rec = census();
      const before = structuredClone(rec);
      const deps = dependencies(source);
      await runClinicalFill(rec, rec.date, deps);

      expect(stored).toMatchObject({ category: 'C2', recordedDate: '2026-10-26' });
      expect(deps.applyPatch).toHaveBeenCalled();
      for (const [patch] of deps.applyPatch.mock.calls) {
        expect(patch).not.toHaveProperty('beds.R1.evaluationScores');
      }
      expect(deps.applyHistoricalCudyr).not.toHaveBeenCalled();
      expect(rec).toEqual(before);
      expect(deps.archiveCudyrCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          evaluations: [],
          capture: expect.objectContaining({
            clinicalEpisodeId: episode,
            status: 'not_observed',
          }),
        })
      );
    }
  );

  it('archives a recovered morning result on the previous night, not the late-created day', async () => {
    const rec = census('2026-10-27');
    rec.beds.R1.evaluationScores = {};
    const deps = dependencies({ ...response(), items: [row], observedEpisodeIds: [episode] });
    const result = await runClinicalFill(rec, rec.date, deps);

    expect(result.errors).toEqual([]);
    expect(deps.applyHistoricalCudyr).toHaveBeenCalledExactlyOnceWith(
      episode,
      '2026-10-26',
      expect.objectContaining({ category: 'C2', recordedAt: row.crdDateTime })
    );
    for (const [patch] of deps.applyPatch.mock.calls) {
      expect(patch).not.toHaveProperty('beds.R1.evaluationScores');
    }
  });

  it('does not invent a CUDYR when neither HHR nor the current source has captured it', async () => {
    const rec = census();
    rec.beds.R1.evaluationScores = {};
    const deps = dependencies();
    await runClinicalFill(rec, rec.date, deps);

    for (const [patch] of deps.applyPatch.mock.calls) {
      expect(patch).not.toHaveProperty('beds.R1.evaluationScores');
    }
    expect(deps.applyHistoricalCudyr).not.toHaveBeenCalled();
    expect(deps.archiveCudyrCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluations: [],
        capture: expect.objectContaining({ status: 'not_observed' }),
      })
    );
  });

  it('keeps explicit official empty-history authority for an observed episode without a category row', async () => {
    const rec = census();
    const deps = dependencies({ ...response(), observedEpisodeIds: [episode] });
    await runClinicalFill(rec, rec.date, deps);

    expect(deps.applyPatch).toHaveBeenCalledWith(
      expect.objectContaining({ 'beds.R1.evaluationScores': {} }),
      expect.anything()
    );
    expect(deps.archiveCudyrCapture).toHaveBeenCalledWith(
      expect.objectContaining({ capture: expect.objectContaining({ status: 'observed' }) })
    );
  });
});

describe('runClinicalFill historical CUDYR telemetry', () => {
  it('persists aggregate evidence when a historical administrative override wins', async () => {
    const summary = await runClinicalFill(
      singleRecord('2026-07-16', 'Paciente uno'),
      '2026-07-16',
      singleDeps({
        fetchCudyrCategories: vi.fn().mockResolvedValue({
          items: [
            {
              encId: 'E1',
              crdValue: 'C2',
              crdDateTime: '2026-07-16T07:00:00+00:00',
              source: 'gestion_camas',
            },
          ],
          source: 'gestion_camas',
          historyAvailable: true,
        }),
        applyHistoricalCudyrBatch: vi.fn().mockResolvedValue({
          results: [
            {
              clinicalEpisodeId: 'E1',
              persisted: false,
              changed: false,
              administrativeOverridePreserved: true,
            },
          ],
        }),
      })
    );

    expect(summary.errors).toEqual([]);
    expect(summary.performance?.counters.administrativeOverridesPreserved).toBe(1);
  });

  it('separates historical persistence and counts every retry in aggregate history', async () => {
    let clock = 0;
    const applyHistoricalCudyrBatch = vi.fn().mockImplementation(async (_day, items) => ({
      results: items.map((item: { clinicalEpisodeId: string }) => ({
        clinicalEpisodeId: item.clinicalEpisodeId,
        persisted: true,
        changed: true,
      })),
      persistence: {
        scope: 'historical' as const,
        callableAttempts: 2,
        clientRetries: 1,
        transactionRetries: 1,
      },
    }));
    const summary = await runClinicalFill(
      singleRecord('2026-07-16', 'Paciente uno'),
      '2026-07-16',
      singleDeps({
        monotonicNow: () => (clock += 10),
        fetchCudyrCategories: vi.fn().mockResolvedValue({
          items: [
            {
              encId: 'E1',
              crdValue: 'C2',
              crdDateTime: '2026-07-16T07:00:00+00:00',
              source: 'gestion_camas',
            },
          ],
          source: 'gestion_camas',
          historyAvailable: true,
        }),
        applyHistoricalCudyrBatch,
      })
    );

    expect(summary.performance).toMatchObject({
      stagesMs: {
        historicalCudyrPersistence: expect.any(Number),
        currentClinicalPersistence: expect.any(Number),
      },
      counters: { retries: 2 },
      persistenceTrace: {
        historical: {
          callableAttempts: 2,
          clientRetries: 1,
          transactionRetries: 1,
        },
      },
    });
  });

  it('keeps aggregate historical retries from a successful pre-telemetry backend', async () => {
    const summary = await runClinicalFill(
      singleRecord('2026-07-16', 'Paciente uno'),
      '2026-07-16',
      singleDeps({
        fetchCudyrCategories: vi.fn().mockResolvedValue({
          items: [
            {
              encId: 'E1',
              crdValue: 'C2',
              crdDateTime: '2026-07-16T07:00:00+00:00',
              source: 'gestion_camas',
            },
          ],
          source: 'gestion_camas',
          historyAvailable: true,
        }),
        applyHistoricalCudyrBatch: vi.fn().mockImplementation(async (_day, items) => ({
          results: items.map((item: { clinicalEpisodeId: string }) => ({
            clinicalEpisodeId: item.clinicalEpisodeId,
            persisted: true,
            changed: true,
          })),
          retries: 1,
        })),
      })
    );

    expect(summary.performance).toMatchObject({ counters: { retries: 1 } });
    expect(summary.performance).not.toHaveProperty('persistenceTrace');
  });
});

describe('daily sync recovers the prior night after discharge', () => {
  it('updates the owning census even when the episode is only a discharge in the selected day', async () => {
    const patient = {
      ...createEmptyPatient('R1'),
      clinicalEpisodeId: 'synthetic-discharged-episode',
      patientName: 'Paciente sintético',
    };
    let historical = { ...buildInitializedDayRecord('2026-10-26', null), beds: { R1: patient } };
    const current = buildInitializedDayRecord('2026-10-27', null);
    current.discharges = [
      {
        id: 'synthetic-discharge',
        clinicalEpisodeId: patient.clinicalEpisodeId,
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'Intermedia',
        patientName: patient.patientName,
        rut: 'synthetic-document',
        diagnosis: '',
        time: '14:00',
        movementDate: current.date,
        status: 'Vivo',
        originalData: patient,
      },
    ];
    const before = structuredClone(current);
    const deps: ClinicalFillDeps = {
      fetchDeviceReport: vi.fn(),
      extractDeviceItems: vi.fn(),
      fetchHistoryScales: vi.fn(),
      fetchScalesForms: vi.fn(),
      applyPatch: vi.fn(),
      fetchCudyrCategories: async () => ({
        source: 'gestion_camas',
        historyAvailable: true,
        observedEpisodeIds: [patient.clinicalEpisodeId],
        metadataStatus: 'complete',
        items: [
          {
            encId: patient.clinicalEpisodeId,
            source: 'gestion_camas',
            crdValue: 'C2',
            crdDateTime: '2026-10-27T03:00:00-05:00',
          },
        ],
      }),
      archiveCudyrCapture: async () => 'persisted',
      applyHistoricalCudyrBatch: async (day, items) => {
        expect(day).toBe(historical.date);
        return items.map(item => {
          const result = resolveHistoricalCudyrBatchOperation(
            historical,
            item.clinicalEpisodeId,
            item.cudyr
          );
          if (result.operation?.patch)
            historical = applyPatches(historical, result.operation?.patch);
          return {
            clinicalEpisodeId: item.clinicalEpisodeId,
            persisted: result.matched,
            changed: Boolean(result.operation?.patch),
          };
        });
      },
      now: () => new Date('2026-10-27T20:00:00-05:00'),
      createId: () => 'synthetic-late-daily-sync',
    };
    const onProgress = vi.fn();
    const summary = await runClinicalFill(current, current.date, deps, onProgress);
    expect(summary).toMatchObject({ total: 1, patched: 1, errors: [] });
    expect(onProgress).toHaveBeenLastCalledWith({ done: 1, total: 1 });
    expect(historical.beds.R1.evaluationScores?.cudyr).toMatchObject({
      category: 'C2',
      recordedDate: '2026-10-26',
      recordedAt: '2026-10-27T03:00:00-05:00',
    });
    expect(current).toEqual(before);
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });
});
