// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill } from '@/features/rayen-import/clinicalFillRunner';
import type {
  ClinicalFillDeps,
  ClinicalFillError,
  ClinicalFillSummary,
} from '@/features/rayen-import/contracts/clinicalFillContracts';
import type { ClinicalReadSource } from '@/features/rayen-import/contracts/clinicalReadSelection';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  resolveClinicalStageResult,
  mergeClinicalRetrySummary,
} from '@/features/rayen-import/domain/clinicalStageResolution';

const record = () =>
  ({
    date: '2026-09-27',
    lastUpdated: '2026-09-28T07:00:00Z',
    beds: {
      R2: {
        bedId: 'R2',
        patientName: 'Paciente de prueba',
        clinicalEpisodeId: 'episode-1',
        devices: [],
        evaluationScores: { braden: { total: 20 } },
        lastVitalSigns: { heartRate: 72 },
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
  }) as unknown as DailyRecord;
const deps = (): ClinicalFillDeps => ({
  fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '', entries: [], source: 'json' }),
  extractDeviceItems: vi.fn().mockResolvedValue([]),
  fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
  fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
  fetchPatientClinicalBundle: vi.fn().mockResolvedValue(null),
  fetchCudyrCategories: vi
    .fn()
    .mockResolvedValue({ items: [], source: 'gestion_camas', historyAvailable: true }),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  registerStaff: vi.fn(async items => items),
  now: () => new Date('2026-09-28T07:00:00Z'),
  createId: () => 'synthetic-id',
});
const issue = (source: ClinicalFillError['source'], bedId = 'R2'): ClinicalFillError => ({
  source,
  bedId,
  ...(bedId === '*' ? {} : { clinicalEpisodeId: 'episode-1' }),
  reason: 'source_unavailable',
  message: 'fuente no disponible',
});
const retry = (rec: DailyRecord, errors: ClinicalFillError[], completionFailed = false) => {
  const result = resolveClinicalStageResult(
    rec,
    rec,
    undefined,
    { total: 1, patched: 0, errors },
    completionFailed
  );
  if (result.status === 'complete' || !result.retry) throw new Error('Expected pending retry');
  return result.retry;
};

describe('manual clinical retry source selection', () => {
  it('recovers a production-shaped global staffing registration failure with history alone', async () => {
    const rec = record();
    const initial = deps();
    vi.mocked(initial.registerStaff!).mockRejectedValue(new Error('registry unavailable'));
    const failed = await runClinicalFill(rec, rec.date, initial);
    expect(failed.errors).toEqual([expect.objectContaining({ bedId: '*', source: 'staffing' })]);
    const token = retry(rec, failed.errors);
    const readers = deps();
    const result = await runClinicalFill(rec, rec.date, {
      ...readers,
      pendingReads: token.pendingReads,
    });
    expect(result.errors).toEqual([]);
    expect(readers.fetchHistoryScales).toHaveBeenCalledTimes(1);
    expect(readers.registerStaff).toHaveBeenCalledTimes(1);
    expect(readers.fetchDeviceReport).not.toHaveBeenCalled();
    expect(readers.fetchScalesForms).not.toHaveBeenCalled();
    expect(readers.fetchCudyrCategories).not.toHaveBeenCalled();
  });

  it('rereads the full confirmed history cohort when recovering run-wide staffing', async () => {
    const rec = record();
    rec.beds.H1C1 = { ...rec.beds.R2, bedId: 'H1C1', clinicalEpisodeId: 'episode-2' };
    const token = retry(rec, [issue('staffing')]);
    expect(token.pendingClinicalEpisodeIds).toEqual(['episode-1', 'episode-2']);
    expect(token.pendingReads).toEqual({ 'episode-1': ['history'], 'episode-2': ['history'] });
    const readers = deps();
    vi.mocked(readers.fetchHistoryScales).mockImplementation(async episode => ({
      events: [],
      nursingActivity: [
        {
          author: episode === 'episode-1' ? 'Ana Prueba' : 'Berta Prueba',
          role: 'Enfermera',
          recordedAt: '2026-09-27T14:00:00-05:00',
          source: 'shift-change',
        },
      ],
    }));
    await runClinicalFill(rec, rec.date, {
      ...readers,
      pendingReads: token.pendingReads,
      allowedClinicalEpisodeIds: token.pendingClinicalEpisodeIds,
    });
    expect(readers.fetchHistoryScales).toHaveBeenCalledTimes(2);
    expect(readers.registerStaff).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ author: 'Ana Prueba' }),
        expect.objectContaining({ author: 'Berta Prueba' }),
      ])
    );
    expect(readers.fetchDeviceReport).not.toHaveBeenCalled();
    expect(readers.fetchScalesForms).not.toHaveBeenCalled();
    expect(readers.fetchCudyrCategories).not.toHaveBeenCalled();
  });

  it('recovers the original confirmed cohort after a narrowed retry develops a persistence failure', () => {
    const rec = record();
    rec.beds.H1C1 = { ...rec.beds.R2, bedId: 'H1C1', clinicalEpisodeId: 'episode-2' };
    rec.beds.H2C1 = { ...rec.beds.R2, bedId: 'H2C1', clinicalEpisodeId: 'unsafe-episode' };
    const result = resolveClinicalStageResult(
      rec,
      rec,
      ['episode-1'],
      { total: 2, patched: 1, errors: [issue('patch')] },
      false,
      ['episode-1', 'episode-2']
    );
    if (result.status === 'complete' || !result.retry) throw new Error('Expected retry');
    expect(result.retry.pendingClinicalEpisodeIds).toEqual(['episode-1', 'episode-2']);
    expect(result.retry.pendingReads).toEqual({ 'episode-2': ['history'] });
  });

  it('recovers a global CUDYR outage without rereading patient sources or resetting staffing', async () => {
    const rec = record();
    const token = retry(rec, [issue('cudyr', '*')]);
    const readers = deps();
    const current = await runClinicalFill(rec, rec.date, {
      ...readers,
      pendingReads: token.pendingReads,
    });
    expect(readers.fetchCudyrCategories).toHaveBeenCalledTimes(1);
    expect(readers.fetchDeviceReport).not.toHaveBeenCalled();
    expect(readers.fetchHistoryScales).not.toHaveBeenCalled();
    expect(readers.fetchScalesForms).not.toHaveBeenCalled();
    expect(readers.fetchPatientClinicalBundle).not.toHaveBeenCalled();
    expect(readers.registerStaff).not.toHaveBeenCalled();
    expect(readers.applyPatch).not.toHaveBeenCalled();
    expect(current.errors).toEqual([]);
    expect(current.staffingProposal).toBeUndefined();
    const previous = await runClinicalFill(rec, rec.date, deps());
    expect(mergeClinicalRetrySummary(previous, current, new Set(['R2'])).staffingProposal).toBe(
      previous.staffingProposal
    );
  });

  it('updates only CUDYR while retaining previously stored clinical data', async () => {
    const rec = record();
    const readers = deps();
    const token = retry(rec, [issue('cudyr', '*')]);
    vi.mocked(readers.fetchCudyrCategories).mockResolvedValue({
      items: [{ encId: 'episode-1', crdValue: 'C2', crdDateTime: '2026-09-28T07:00:00Z' }],
      source: 'gestion_camas',
      historyAvailable: true,
    });
    const summary = await runClinicalFill(rec, rec.date, {
      ...readers,
      pendingReads: token.pendingReads,
    });
    expect(summary.errors).toEqual([]);
    const [patch, target] = vi.mocked(readers.applyPatch).mock.calls[0];
    expect(patch['beds.R2.evaluationScores']).toMatchObject({
      braden: { total: 20 },
      cudyr: { category: 'C2' },
    });
    expect(
      Object.keys(patch).every(
        key => key === 'beds.R2.evaluationScores' || key === 'beds.R2.clinicalSyncCheckpoint'
      )
    ).toBe(true);
    expect(target).toMatchObject({ clinicalEpisodeId: 'episode-1', censusDate: rec.date });
  });

  it.each<{ source: ClinicalFillError['source']; expected: ClinicalReadSource[] }>([
    { source: 'devices', expected: ['devices'] },
    { source: 'vitals', expected: ['forms'] },
    { source: 'scales', expected: ['history', 'forms'] },
    { source: 'staffing', expected: ['history'] },
  ])('retries only the readers required by $source', async ({ source, expected }) => {
    const rec = record();
    const readers = deps();
    const token = retry(rec, [issue(source)]);
    await runClinicalFill(rec, rec.date, { ...readers, pendingReads: token.pendingReads });
    for (const [name, read] of [
      ['devices', readers.fetchDeviceReport],
      ['history', readers.fetchHistoryScales],
      ['forms', readers.fetchScalesForms],
      ['cudyr', readers.fetchCudyrCategories],
    ] as const) {
      expect(read).toHaveBeenCalledTimes(expected.includes(name) ? 1 : 0);
    }
    expect(readers.fetchPatientClinicalBundle).not.toHaveBeenCalled();
  });

  it('unions global and episode-specific failures and follows the episode after a bed move', async () => {
    const rec = record();
    const token = retry(rec, [issue('cudyr', '*'), issue('vitals')]);
    rec.beds.H1C1 = { ...rec.beds.R2, bedId: 'H1C1' };
    delete rec.beds.R2;
    const readers = deps();
    await runClinicalFill(rec, rec.date, { ...readers, pendingReads: token.pendingReads });
    expect(readers.fetchScalesForms).toHaveBeenCalledWith('episode-1');
    expect(readers.fetchCudyrCategories).toHaveBeenCalledTimes(1);
    expect(readers.fetchHistoryScales).not.toHaveBeenCalled();
    expect(readers.fetchDeviceReport).not.toHaveBeenCalled();
  });

  it('does not use another episode selection for a new occupant of the same bed', async () => {
    const rec = record();
    const token = retry(rec, [issue('cudyr', '*')]);
    rec.beds.R2.clinicalEpisodeId = 'episode-2';
    const readers = deps();
    const result = await runClinicalFill(rec, rec.date, {
      ...readers,
      pendingReads: token.pendingReads,
      allowedClinicalEpisodeIds: token.pendingClinicalEpisodeIds,
    });
    expect(result.total).toBe(0);
    expect(result.staffingProposal).toBeUndefined();
    expect(readers.fetchCudyrCategories).not.toHaveBeenCalled();
    expect(readers.applyPatch).not.toHaveBeenCalled();
  });

  it.each(['patch', 'census'] as const)(
    'falls back to complete evidence after a %s failure',
    async source => {
      const rec = record();
      const readers = deps();
      const token = retry(rec, [issue(source)]);
      await runClinicalFill(rec, rec.date, { ...readers, pendingReads: token.pendingReads });
      expect(readers.fetchDeviceReport).toHaveBeenCalledTimes(1);
      expect(readers.fetchHistoryScales).toHaveBeenCalledTimes(1);
      expect(readers.fetchScalesForms).toHaveBeenCalledTimes(1);
      expect(readers.fetchCudyrCategories).toHaveBeenCalledTimes(1);
    }
  );

  it('falls back to complete evidence when audit completion failed', () => {
    expect(retry(record(), [issue('cudyr', '*')], true).pendingReads).toBeUndefined();
  });

  it('retains a CUDYR-only retry after another outage instead of inventing missing sources', async () => {
    const rec = record();
    const readers = deps();
    const token = retry(rec, [issue('cudyr', '*')]);
    vi.mocked(readers.fetchCudyrCategories).mockRejectedValue(new Error('timeout'));
    const summary: ClinicalFillSummary = await runClinicalFill(rec, rec.date, {
      ...readers,
      pendingReads: token.pendingReads,
    });
    expect(summary.errors).toHaveLength(1);
    expect(retry(rec, summary.errors).pendingReads).toEqual({ 'episode-1': ['cudyr'] });
  });
});
