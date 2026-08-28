import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from '@/features/rayen-import';
import { resolveClinicalStageResult } from '@/features/rayen-import/domain/clinicalStageResolution';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const record = (): DailyRecord =>
  ({
    date: '2026-07-16',
    beds: {
      H1C2: { bedId: 'H1C2', patientName: 'Paciente uno', clinicalEpisodeId: 'E1', devices: [] },
      H2C1: { bedId: 'H2C1', patientName: 'Paciente dos', clinicalEpisodeId: 'E2', devices: [] },
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
  }) as unknown as DailyRecord;

const singleRecord = (date = '2026-07-10'): DailyRecord => {
  const rec = record();
  rec.date = date;
  delete rec.beds.H2C1;
  return rec;
};

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

const expectCheckpointOnlyPatch = (applyPatch: ClinicalFillDeps['applyPatch']): void => {
  expect(applyPatch).toHaveBeenCalledTimes(1);
  expect(Object.keys((applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toEqual([
    'beds.H1C2.clinicalSyncCheckpoint',
  ]);
};

describe('runClinicalFill historical CUDYR batch', () => {
  it('consolidates several patients into one persistence operation', async () => {
    const applyHistoricalCudyr = vi.fn();
    const applyHistoricalCudyrBatch = vi.fn().mockImplementation(async (_day, items) =>
      items.map((item: { clinicalEpisodeId: string }) => ({
        clinicalEpisodeId: item.clinicalEpisodeId,
        persisted: true,
        changed: true,
      }))
    );
    const deps: ClinicalFillDeps = {
      fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
      extractDeviceItems: vi.fn().mockResolvedValue([]),
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          {
            encId: 'E1',
            crdValue: 'C2',
            crdDateTime: '2026-07-16T07:00:00+00:00',
            source: 'gestion_camas',
          },
          {
            encId: 'E2',
            crdValue: 'B1',
            crdDateTime: '2026-07-16T07:30:00+00:00',
            source: 'gestion_camas',
          },
        ],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
      applyHistoricalCudyr,
      applyHistoricalCudyrBatch,
      applyPatch: vi.fn().mockResolvedValue(undefined),
      now: () => new Date(Date.UTC(2026, 6, 16, 12, 0, 0)),
      createId: () => 'id-1',
    };

    const summary = await runClinicalFill(record(), '2026-07-16', deps);

    expect(summary).toMatchObject({ total: 2, patched: 2, errors: [] });
    expect(applyHistoricalCudyr).not.toHaveBeenCalled();
    expect(applyHistoricalCudyrBatch).toHaveBeenCalledTimes(1);
    expect(applyHistoricalCudyrBatch).toHaveBeenCalledWith('2026-07-15', [
      expect.objectContaining({
        clinicalEpisodeId: 'E1',
        cudyr: expect.objectContaining({ category: 'C2' }),
      }),
      expect.objectContaining({
        clinicalEpisodeId: 'E2',
        cudyr: expect.objectContaining({ category: 'B1' }),
      }),
    ]);
    expect(deps.applyPatch).toHaveBeenCalledTimes(2);
  });

  it('contains an eager batch rejection until each patient can report it normally', async () => {
    let confirmBatchAttempt: (() => void) | undefined;
    const batchAttempted = new Promise<void>(resolve => {
      confirmBatchAttempt = resolve;
    });
    const applyHistoricalCudyrBatch = vi.fn().mockImplementation(async () => {
      confirmBatchAttempt?.();
      throw Object.assign(new Error('write unavailable'), { clinicalBatchRetries: 1 });
    });
    const deps: ClinicalFillDeps = {
      fetchDeviceReport: vi.fn().mockImplementation(async () => {
        await batchAttempted;
        return { base64: '' };
      }),
      extractDeviceItems: vi.fn().mockResolvedValue([]),
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          {
            encId: 'E1',
            crdValue: 'C2',
            crdDateTime: '2026-07-16T07:00:00+00:00',
            source: 'gestion_camas',
          },
          {
            encId: 'E2',
            crdValue: 'B1',
            crdDateTime: '2026-07-16T07:30:00+00:00',
            source: 'gestion_camas',
          },
        ],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
      applyHistoricalCudyrBatch,
      applyPatch: vi.fn().mockResolvedValue(undefined),
      now: () => new Date(Date.UTC(2026, 6, 16, 12, 0, 0)),
      createId: () => 'id-1',
    };

    const summary = await runClinicalFill(record(), '2026-07-16', deps);

    expect(summary.errors).toEqual([
      expect.objectContaining({
        bedId: 'H1C2',
        source: 'cudyr',
        message: expect.stringContaining('write unavailable'),
      }),
      expect.objectContaining({
        bedId: 'H2C1',
        source: 'cudyr',
        message: expect.stringContaining('write unavailable'),
      }),
    ]);
    expect(summary.performance).toMatchObject({
      counters: { retries: 1 },
    });
    expect(summary.performance).not.toHaveProperty('persistenceTrace');
  });

  it('keeps a stored CUDYR when its historical archive is not applicable', async () => {
    const rec = record();
    delete rec.beds.H2C1;
    rec.date = '2026-07-11';
    (rec.beds.H1C2 as { evaluationScores?: unknown }).evaluationScores = {
      cudyr: { category: 'D3', recordedDate: '2026-07-11', source: 'Eloísa (Rayen)' },
    };
    const applyPatch = vi.fn().mockResolvedValue(undefined);
    const deps: ClinicalFillDeps = {
      fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
      extractDeviceItems: vi.fn().mockResolvedValue([]),
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          {
            encId: 'E1',
            crdValue: 'D3',
            crdDateTime: '2026-07-10T23:12:04.74+00:00',
            source: 'gestion_camas',
          },
        ],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
      applyHistoricalCudyr: vi.fn().mockResolvedValue({
        persisted: false,
        changed: false,
        applicable: false,
      }),
      applyPatch,
      now: () => new Date(Date.UTC(2026, 6, 11, 12, 0, 0)),
      createId: () => 'id-1',
    };

    const summary = await runClinicalFill(rec, '2026-07-11', deps);

    expect(summary).toMatchObject({ total: 1, patched: 0, errors: [] });
    expect(applyPatch).toHaveBeenCalledTimes(1);
    expect(Object.keys(applyPatch.mock.calls[0][0])).toEqual(['beds.H1C2.clinicalSyncCheckpoint']);
  });

  it('archives a sanitized 00:08 D+1 official application into census D by episode', async () => {
    const rec = record();
    rec.date = '2026-08-17';
    delete rec.beds.H2C1;
    rec.beds.H1C2.clinicalEpisodeId = 'EPISODE-SANITIZED';
    const applyHistoricalCudyrBatch = vi.fn().mockImplementation(async (_day, items) =>
      items.map((item: { clinicalEpisodeId: string }) => ({
        clinicalEpisodeId: item.clinicalEpisodeId,
        persisted: true,
        changed: true,
      }))
    );
    const deps: ClinicalFillDeps = {
      fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
      extractDeviceItems: vi.fn().mockResolvedValue([]),
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          {
            encId: 'EPISODE-SANITIZED',
            crdValue: 'C1',
            crdDateTime: '2026-08-17T06:08:00.000Z',
            history: [{ category: 'C1', recordedAt: '2026-08-17T06:08:00.000Z' }],
          },
        ],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
      applyHistoricalCudyrBatch,
      applyPatch: vi.fn().mockResolvedValue(undefined),
      now: () => new Date('2026-08-17T12:00:00.000Z'),
      createId: () => 'id-1',
    };

    const summary = await runClinicalFill(rec, '2026-08-17', deps);

    expect(deps.fetchCudyrCategories).toHaveBeenCalledTimes(1);
    expect(applyHistoricalCudyrBatch).toHaveBeenCalledTimes(1);
    expect(applyHistoricalCudyrBatch).toHaveBeenCalledWith('2026-08-16', [
      expect.objectContaining({
        clinicalEpisodeId: 'EPISODE-SANITIZED',
        cudyr: expect.objectContaining({
          category: 'C1',
          recordedDate: '2026-08-16',
          recordedAt: '2026-08-17T06:08:00.000Z',
        }),
      }),
    ]);
    expect(summary.errors).toEqual([]);
  });

  it('reports one source failure when the shared Gestión de Camas capture fails', async () => {
    const deps = singleDeps({
      fetchCudyrCategories: vi.fn().mockRejectedValue(new Error('sin relay CUDYR')),
    });
    const summary = await runClinicalFill(singleRecord(), '2026-07-10', deps);

    expect(summary.patched).toBe(0);
    expect(summary.errors).toEqual([
      {
        bedId: '*',
        source: 'cudyr',
        reason: 'source_unavailable',
        message: 'CUDYR no pudo consultarse en Gestión de Camas: sin relay CUDYR',
      },
    ]);
    expectCheckpointOnlyPatch(deps.applyPatch);
    expect(
      resolveClinicalStageResult(singleRecord(), singleRecord(), undefined, summary, false)
    ).toMatchObject({
      status: 'partial',
      retry: { pendingClinicalEpisodeIds: ['E1'] },
    });
  });

  it('verifies the shared Gestión de Camas capture before starting patient clinical reads', async () => {
    let releaseCudyr:
      | ((value: { items: []; source: 'gestion_camas'; historyAvailable: true }) => void)
      | undefined;
    const fetchCudyrCategories = vi.fn(
      () =>
        new Promise<{
          items: [];
          source: 'gestion_camas';
          historyAvailable: true;
        }>(resolve => {
          releaseCudyr = resolve;
        })
    );
    const fetchDeviceReport = vi.fn().mockResolvedValue({ base64: '' });
    const fetchHistoryScales = vi.fn().mockResolvedValue({ events: [] });
    const fetchScalesForms = vi.fn().mockResolvedValue({ forms: [] });
    const deps = singleDeps({
      fetchCudyrCategories,
      fetchDeviceReport,
      fetchHistoryScales,
      fetchScalesForms,
    });

    const pending = runClinicalFill(singleRecord(), '2026-07-10', deps);
    await vi.waitFor(() => expect(fetchCudyrCategories).toHaveBeenCalledTimes(1));
    expect(fetchDeviceReport).not.toHaveBeenCalled();
    expect(fetchHistoryScales).not.toHaveBeenCalled();
    expect(fetchScalesForms).not.toHaveBeenCalled();

    releaseCudyr?.({ items: [], source: 'gestion_camas', historyAvailable: true });
    await expect(pending).resolves.toMatchObject({ total: 1, errors: [] });
    expect(fetchDeviceReport).toHaveBeenCalledTimes(1);
  });

  it('keeps fallback current data but marks coverage partial without official history', async () => {
    const applyHistoricalCudyr = vi.fn();
    const rec = singleRecord();
    const deps = singleDeps({
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          {
            encId: 'E1',
            crdValue: 'C2',
            crdDateTime: '2026-07-10T18:00:00+00:00',
            source: 'ficha_medico',
          },
        ],
        source: 'ficha_medico',
        historyAvailable: false,
        warning: 'La sesión de Gestión de Camas no está disponible.',
      }),
      applyHistoricalCudyr,
    });

    const summary = await runClinicalFill(rec, '2026-07-10', deps);

    expect(summary.patched).toBe(1);
    expect(summary.errors).toContainEqual({
      bedId: '*',
      source: 'cudyr',
      reason: 'source_unavailable',
      message:
        'CUDYR no pudo consultarse en Gestión de Camas: La sesión de Gestión de Camas no está disponible.',
    });
    expect(applyHistoricalCudyr).not.toHaveBeenCalled();
    expect(resolveClinicalStageResult(rec, rec, undefined, summary, false).status).toBe('partial');
  });

  it('fails closed when a mixed capture omits per-episode provenance', async () => {
    const applyHistoricalCudyr = vi.fn();
    const deps = singleDeps({
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          {
            encId: 'E1',
            crdValue: 'C2',
            crdDateTime: '2026-07-10T18:00:00+00:00',
          },
        ],
        source: 'gestion_camas+ficha_medico',
        historyAvailable: true,
      }),
      applyHistoricalCudyr,
    });

    const summary = await runClinicalFill(singleRecord(), '2026-07-10', deps);

    expect(summary.errors).toContainEqual({
      bedId: '*',
      source: 'cudyr',
      reason: 'source_unavailable',
      message:
        'CUDYR no pudo consultarse en Gestión de Camas: la extensión no informó la procedencia CUDYR de cada episodio',
    });
    expect(applyHistoricalCudyr).not.toHaveBeenCalled();
    const patch = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch['beds.H1C2.evaluationScores'].cudyr).toMatchObject({
      category: 'C2',
      source: 'Eloísa · Ficha Médico',
    });
  });

  it('removes a legacy CUDYR misfiled on D+1 only after an authoritative read', async () => {
    const rec = singleRecord('2026-07-11');
    (rec.beds.H1C2 as { evaluationScores?: unknown }).evaluationScores = {
      cudyr: { category: 'D3', recordedDate: '2026-07-11', source: 'Eloísa (Rayen)' },
    };
    const deps = singleDeps({
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          {
            encId: 'E1',
            crdValue: 'D3',
            crdDateTime: '2026-07-10T23:12:04.74+00:00',
            source: 'gestion_camas',
          },
        ],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
      applyHistoricalCudyr: vi.fn().mockResolvedValue({ persisted: true, changed: true }),
    });
    const summary = await runClinicalFill(rec, '2026-07-11', deps);

    expect(summary.patched).toBe(1);
    const patch = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch['beds.H1C2.evaluationScores'].cudyr).toBeUndefined();
  });

  it('keeps stored CUDYR when the read rejects, resolves without authority, or reports an error', async () => {
    const makeRecord = (): DailyRecord => {
      const rec = singleRecord('2026-07-11');
      (rec.beds.H1C2 as { evaluationScores?: unknown }).evaluationScores = {
        cudyr: { category: 'D3', recordedDate: '2026-07-10', source: 'Eloísa (Rayen)' },
      };
      return rec;
    };
    const rejectedDeps = singleDeps({
      fetchCudyrCategories: vi.fn().mockRejectedValue(new Error('timeout')),
    });
    const unavailableDeps = singleDeps({
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [],
        error: 'Gestión de Camas no disponible',
      }),
    });
    const erroredOfficialDeps = singleDeps({
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          {
            encId: 'E1',
            crdValue: 'C1',
            crdDateTime: '2026-07-11T07:00:00+00:00',
            source: 'gestion_camas',
          },
        ],
        source: 'gestion_camas',
        historyAvailable: true,
        error: 'Gestión de Camas entregó una respuesta incompleta',
      }),
    });

    const rejected = await runClinicalFill(makeRecord(), '2026-07-11', rejectedDeps);
    const unavailable = await runClinicalFill(makeRecord(), '2026-07-11', unavailableDeps);
    const erroredOfficial = await runClinicalFill(makeRecord(), '2026-07-11', erroredOfficialDeps);

    expect(rejected.patched).toBe(0);
    expectCheckpointOnlyPatch(rejectedDeps.applyPatch);
    expect(unavailable.errors).toContainEqual({
      bedId: '*',
      source: 'cudyr',
      reason: 'source_unavailable',
      message: 'CUDYR no pudo consultarse en Gestión de Camas: Gestión de Camas no disponible',
    });
    expectCheckpointOnlyPatch(unavailableDeps.applyPatch);
    expect(erroredOfficial.patched).toBe(0);
    expect(erroredOfficial.errors).toContainEqual({
      bedId: '*',
      source: 'cudyr',
      reason: 'source_unavailable',
      message:
        'CUDYR no pudo consultarse en Gestión de Camas: Gestión de Camas entregó una respuesta incompleta',
    });
    expectCheckpointOnlyPatch(erroredOfficialDeps.applyPatch);
  });
});
