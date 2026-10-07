import { captureClinicalCudyrSource } from '@/features/rayen-import/domain/clinicalCudyrPreflight';
import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill } from '@/features/rayen-import/clinicalFillRunner';
import type { ClinicalFillDeps } from '@/features/rayen-import/contracts/clinicalFillContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { buildCudyrCaptureParts } from '@/features/rayen-import/domain/cudyrCapturePlan';
import { persistCudyrSyncCapture } from '@/features/rayen-import/domain/persistCudyrSyncCapture';
import type { ClinicalCudyrSource } from '@/features/rayen-import/domain/clinicalCudyrPreflight';

const history = [
  {
    id: 'event-test',
    category: 'C2',
    recordedAt: '2026-10-03T03:00:00-05:00',
    authorId: 'professional-test',
    author: 'Profesional sintético',
    sourceVersion: 'opaque-1',
    isDeleted: true,
  },
];
const source: ClinicalCudyrSource = {
  historyAvailable: true,
  captureContract: 1,
  observedEpisodeIds: ['episode-test'],
  metadataStatus: 'complete',
  map: new Map([
    [
      'episode-test',
      {
        encId: 'episode-test',
        crdValue: '',
        crdDateTime: '',
        source: 'gestion_camas',
        history: [],
        observations: history,
        metadataComplete: true,
      },
    ],
  ]),
};
const input = {
  authorityDate: '2026-10-06',
  censusDate: '2026-10-06',
  runId: 'run-test',
  captureId: '00000000-0000-4000-8000-000000000001',
  observedAt: '2026-10-06T20:00:00.000Z',
  clinicalEpisodeId: 'episode-test',
  source,
};

describe('ordinary sync permanent CUDYR archive', () => {
  it('archives an old source version and its tombstone without changing attribution', () => {
    const [part] = buildCudyrCaptureParts(input);
    expect(part.evaluations).toEqual([
      {
        ...history[0],
        id: undefined,
        sourceEvaluationId: 'event-test',
        source: 'gestion_camas',
        clinicalEpisodeId: 'episode-test',
      },
    ]);
    expect(part.capture).toMatchObject({
      status: 'observed',
      sourceRunId: 'run-test',
      totalParts: 1,
    });
  });

  it('distinguishes an observed empty history from a missing episode, unavailable source and older extension', () => {
    const status = (next: ClinicalCudyrSource) =>
      buildCudyrCaptureParts({ ...input, source: next })[0].capture?.status;
    expect(status({ ...source, map: new Map() })).toBe('observed');
    expect(status({ ...source, map: new Map(), observedEpisodeIds: [] })).toBe('not_observed');
    expect(status({ ...source, historyAvailable: false })).toBe('unavailable');
    expect(status({ ...source, captureContract: undefined })).toBe('legacy_extension');
  });

  it('splits history into complete numbered parts without truncating or inventing source IDs', () => {
    const entries = Array.from({ length: 65 }, (_, index) => ({
      ...history[0],
      id: `event-${index}`,
    }));
    const row = { ...source.map.get('episode-test')!, observations: entries };
    const parts = buildCudyrCaptureParts({
      ...input,
      source: { ...source, map: new Map([['episode-test', row]]) },
    });
    expect(parts.map(part => part.evaluations.length)).toEqual([32, 32, 1]);
    expect(parts.map(part => part.capture?.part)).toEqual([0, 1, 2]);
    expect(
      parts.every(part => part.capture?.totalEvaluations === 65 && part.capture.totalParts === 3)
    ).toBe(true);
  });

  it('keeps queued writes visibly incomplete instead of declaring remote persistence', async () => {
    const errors = await persistCudyrSyncCapture({
      ...input,
      episodes: ['episode-test'],
      write: vi.fn().mockResolvedValue('queued'),
    });
    expect(errors).toMatchObject([
      { clinicalEpisodeId: 'episode-test', source: 'cudyr', reason: 'historical_archive_failed' },
    ]);
    expect(errors[0].message).toContain('pendiente de confirmación');
  });

  it('captures during sync even when only an egreso remains, with one shared source fetch', async () => {
    const archiveCudyrCapture = vi.fn().mockResolvedValue('persisted');
    const fetchCudyrCategories = vi.fn().mockResolvedValue({
      items: [...source.map.values()],
      source: 'gestion_camas',
      historyAvailable: true,
      captureContract: 1,
      observedEpisodeIds: source.observedEpisodeIds,
      metadataStatus: 'complete',
    });
    const deps: ClinicalFillDeps = {
      diagnosticRunId: input.runId,
      fetchCudyrCategories,
      archiveCudyrCapture,
      now: () => new Date(input.observedAt),
      createId: () => input.captureId,
      fetchDeviceReport: vi.fn(),
      extractDeviceItems: vi.fn(),
      fetchHistoryScales: vi.fn(),
      fetchScalesForms: vi.fn(),
      applyPatch: vi.fn(),
    };
    const record = {
      date: input.censusDate,
      beds: {},
      discharges: [{ originalData: { clinicalEpisodeId: 'episode-test' } }],
      transfers: [],
      cma: [],
    } as unknown as DailyRecord;
    const before = structuredClone(record);
    const result = await runClinicalFill(record, input.censusDate, deps);
    expect(result.errors).toEqual([]);
    expect(fetchCudyrCategories).toHaveBeenCalledOnce();
    expect(archiveCudyrCapture).toHaveBeenCalledWith(
      expect.objectContaining({ evaluations: [expect.objectContaining({ isDeleted: true })] })
    );
    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(record).toEqual(before);
  });

  it.each(['failed', 'unavailable', 'partial'])(
    'reports %s source exactly once when only an egreso remains',
    async mode => {
      const fetchCudyrCategories = vi.fn().mockImplementation(async () => {
        if (mode === 'failed') throw new Error('Source unavailable');
        return {
          items: [],
          source: 'gestion_camas',
          historyAvailable: mode !== 'unavailable',
          captureContract: 1,
          observedEpisodeIds: ['episode-test'],
          metadataStatus: mode === 'partial' ? 'partial' : 'complete',
        };
      });
      const archiveCudyrCapture = vi.fn().mockResolvedValue('persisted');
      const deps: ClinicalFillDeps = {
        diagnosticRunId: input.runId,
        fetchCudyrCategories,
        archiveCudyrCapture,
        now: () => new Date(input.observedAt),
        createId: () => input.captureId,
        fetchDeviceReport: vi.fn(),
        extractDeviceItems: vi.fn(),
        fetchHistoryScales: vi.fn(),
        fetchScalesForms: vi.fn(),
        applyPatch: vi.fn(),
      };
      const record = {
        date: input.censusDate,
        beds: {},
        discharges: [{ originalData: { clinicalEpisodeId: 'episode-test' } }],
        transfers: [],
        cma: [],
      } as unknown as DailyRecord;
      const result = await runClinicalFill(record, input.censusDate, deps);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].source).toBe('cudyr');
      expect(archiveCudyrCapture).toHaveBeenCalledOnce();
      expect(deps.applyPatch).not.toHaveBeenCalled();
    }
  );
});

describe('archive metadata warnings in compatible sync modes', () => {
  it('requires complete provenance only when permanent capture is enabled', async () => {
    const fetch = async () => ({
      items: [],
      source: 'gestion_camas' as const,
      historyAvailable: true,
      metadataStatus: 'partial' as const,
    });
    const dependencies = {
      fetch,
      trackRequest: <T>(operation: () => Promise<T>) => operation(),
      recordTimeout: vi.fn(),
    };
    expect((await captureClinicalCudyrSource(dependencies)).unavailableError).toBeUndefined();
    expect(
      (await captureClinicalCudyrSource({ ...dependencies, requireCompleteMetadata: true }))
        .unavailableError?.message
    ).toContain('incompleta');
  });
});

it('carries source placement evidence unchanged in every archived part', () => {
  const sourcePlacements = [
    {
      clinicalEpisodeId: 'episode-test',
      sourceMappingId: 'mapping',
      sourceBedId: 'bed',
      sourceBedLabel: 'CH1C1',
      sourceDepartmentId: 'department',
      sourceDepartmentLabel: 'Cuna',
      sourceVersion: 'opaque',
      sourceStartAt: '2026-10-01T10:00:00-05:00',
      sourceEndAt: '0001-01-01T00:00:00Z',
      currentAssignment: true,
      isDeleted: false,
      bedId: 'H1C1',
      modality: 'cuna' as const,
    },
  ];
  const row = {
    ...source.map.get('episode-test')!,
    sourcePlacements,
    observations: Array.from({ length: 33 }, (_, index) => ({
      ...history[0],
      id: `event-${index}`,
    })),
  };
  const parts = buildCudyrCaptureParts({
    ...input,
    source: { ...source, map: new Map([['episode-test', row]]) },
  });
  expect(parts).toHaveLength(2);
  expect(parts.every(part => part.capture?.sourcePlacements === sourcePlacements)).toBe(true);
});
