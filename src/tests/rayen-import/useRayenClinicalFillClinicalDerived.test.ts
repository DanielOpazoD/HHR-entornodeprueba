import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const mocks = vi.hoisted(() => ({
  isFirestoreEnabled: vi.fn(() => true),
  readDocs: vi.fn(),
  readDoc: vi.fn(),
  runClinicalFill: vi.fn(),
  createStrategy: vi.fn(),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: mocks.isFirestoreEnabled,
}));
vi.mock('@/services/storage/firestore/clinicalDerivedEpisodeReader', () => ({
  readClinicalDerivedEpisodeDocs: mocks.readDocs,
  readClinicalDerivedEpisodeDoc: mocks.readDoc,
}));
vi.mock('@/features/rayen-import/clinicalFillRunner', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/rayen-import/clinicalFillRunner')>()),
  runClinicalFill: mocks.runClinicalFill,
}));
vi.mock('@/features/rayen-import/hooks/clinicalEnrichmentPersistenceStrategy', () => ({
  createClinicalEnrichmentPersistenceStrategy: mocks.createStrategy,
}));
vi.mock('@/services/staff/eloisaStaffRegistry', () => ({ registerEloisaStaff: vi.fn() }));
vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  beginRayenFill: () => true,
  endRayenFill: vi.fn(),
  getRayenFillAttemptId: () => 7,
  reportRayenFillProgress: vi.fn(),
  registerRayenFillAbort: vi.fn(),
}));

import { resetRayenClinicalFillQueueForTests } from '@/features/rayen-import/domain/rayenClinicalFillQueue';
import { resolveConfirmedRayenCensusHandoff } from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import { useRayenClinicalFill } from '@/features/rayen-import/hooks/useRayenClinicalFill';

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_a';
const RUN_ID = 'run-synthetic';
const reading = (label: string) => [{ recordedDate: DATE, recordedAt: `${DATE} 08:00`, label }];

const splitDay = (revision = 5, marked = true): DailyRecord =>
  ({
    date: DATE,
    lastUpdated: `${DATE}T10:0${revision}:00.000Z`,
    meta: { revision },
    ...(marked ? { clinicalDerivedLayout: { version: 1, generation: GENERATION } } : {}),
    beds: {
      R1: {
        bedId: 'R1',
        patientName: 'Madre Sintética',
        clinicalEpisodeId: 'ep_mother',
        vitalSignsHistory: reading('embedded-mother'),
        clinicalCrib: {
          bedId: 'R1',
          patientName: 'RN Sintético',
          clinicalEpisodeId: 'ep_newborn',
          vitalSignsHistory: reading('embedded-newborn'),
        },
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    rayenSync: { runId: RUN_ID },
    rayenSyncHistory: [
      {
        id: RUN_ID,
        startedAt: `${DATE}T09:00:00.000Z`,
        by: 'Operador Sintético',
        status: 'applied',
        policy: { mode: 'preview', revision: 1 },
      },
    ],
  }) as unknown as DailyRecord;

const doc = (clinicalEpisodeId: string, dayRevision: number, history: unknown) =>
  ({
    schemaVersion: 1,
    date: DATE,
    clinicalEpisodeId,
    layoutGeneration: GENERATION,
    dayRevision,
    clinicalSyncCheckpoint: null,
    vitalSignsHistory: history,
  }) as ClinicalDerivedEpisodeDoc;

const docsAt = (dayRevision: number) => ({
  status: 'resolved',
  fromCache: false,
  docs: [
    doc('ep_mother', dayRevision, reading('doc-mother')),
    doc('ep_newborn', dayRevision, null),
  ],
});

const renderFill = (loadDailyRecord: () => Promise<DailyRecord>) => {
  const completeRun = vi.fn().mockResolvedValue(undefined);
  const patchDailyRecord = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useRayenClinicalFill({
      nurseCatalog: [],
      tensCatalog: [],
      loadDailyRecord: vi.fn(loadDailyRecord),
      patchDailyRecord,
      applyHistoricalCudyr: vi.fn(),
      completeRun,
      onStaffingProposal: vi.fn(),
      createId: () => 'id',
    })
  );
  return { fill: result.current, completeRun, patchDailyRecord };
};

const metaOf = (record: DailyRecord) => (record as unknown as { meta?: unknown }).meta;
const motherHistory = (record: DailyRecord) => record.beds.R1.vitalSignsHistory;
const newbornHistory = (record: DailyRecord) => record.beds.R1.clinicalCrib?.vitalSignsHistory;
const strategyInput = () => mocks.createStrategy.mock.calls[0][0];

describe('Rayen clinical fill on a split day (D10)', () => {
  beforeEach(() => {
    resetRayenClinicalFillQueueForTests();
    vi.clearAllMocks();
    mocks.isFirestoreEnabled.mockReturnValue(true);
    mocks.runClinicalFill.mockResolvedValue({ total: 2, patched: 0, errors: [] });
    mocks.createStrategy.mockReturnValue({ disposition: 'immediate', persist: vi.fn() });
  });

  it('overlays the reloaded day for the fill, the batch and the patch base; never the audit record', async () => {
    const loaded = splitDay();
    const loadDailyRecord = vi.fn(async () => loaded);
    const { fill, completeRun, patchDailyRecord } = renderFill(loadDailyRecord);
    mocks.readDocs.mockResolvedValue(docsAt(5));

    await act(async () => {
      await fill(loaded);
    });

    expect(mocks.readDocs).toHaveBeenCalledWith(DATE, GENERATION, { source: 'server' });
    const filled = mocks.runClinicalFill.mock.calls[0][0] as DailyRecord;
    expect(motherHistory(filled)).toEqual(reading('doc-mother'));
    expect(newbornHistory(filled)).toBeUndefined();
    expect(metaOf(filled)).toEqual(metaOf(loaded));
    expect(strategyInput().record).toBe(filled);
    await strategyInput().applyPatch({ patch: {}, target: { bedId: 'R1' } });
    await mocks.runClinicalFill.mock.calls[0][2].applyPatch({}, { bedId: 'R1' });
    expect(patchDailyRecord.mock.calls.map(call => call[3])).toEqual([filled, filled]);
    // The audit completion and the retry evidence keep the day as read, without documents.
    expect(completeRun.mock.calls[0][0]).toBe(loaded);
    expect(motherHistory(loaded)).toEqual(reading('embedded-mother'));
  });

  it('overlays the batch re-read at its write turn too', async () => {
    const loaded = splitDay();
    const refreshed = splitDay(6);
    const loadDailyRecord = vi
      .fn<() => Promise<DailyRecord>>()
      .mockResolvedValueOnce(loaded)
      .mockResolvedValueOnce(refreshed);
    const { fill } = renderFill(loadDailyRecord);
    mocks.readDocs.mockResolvedValueOnce(docsAt(5)).mockResolvedValueOnce(docsAt(6));

    await act(async () => {
      await fill(loaded);
    });
    const current = (await strategyInput().refreshRecord()) as DailyRecord;

    expect(loadDailyRecord).toHaveBeenCalledTimes(2);
    expect(current).not.toBe(refreshed);
    expect(metaOf(current)).toEqual(metaOf(refreshed));
    expect(motherHistory(current)).toEqual(reading('doc-mother'));
    expect(motherHistory(refreshed)).toEqual(reading('embedded-mother'));
  });

  it('overlays a confirmed census handoff without reloading the day', async () => {
    const confirmed = splitDay();
    const loadDailyRecord = vi.fn(async () => confirmed);
    const { fill, completeRun } = renderFill(loadDailyRecord);
    mocks.readDocs.mockResolvedValue(docsAt(5));
    const handoff = resolveConfirmedRayenCensusHandoff(
      { record: confirmed, result: { date: DATE, outcome: 'clean' } as SaveDailyRecordResult },
      {
        date: DATE,
        clinicalDay: DATE,
        runId: RUN_ID,
        diff: { conflicts: [] } as unknown as Pick<
          CensusImportDiff,
          'conflicts' | 'deferredHistoricalAdmissionBedIds'
        >,
      }
    );

    await act(async () => {
      await fill(handoff);
    });

    expect(loadDailyRecord).not.toHaveBeenCalled();
    expect(motherHistory(mocks.runClinicalFill.mock.calls[0][0])).toEqual(reading('doc-mother'));
    expect(completeRun.mock.calls[0][0]).toBe(confirmed);
  });

  it('re-reads the day once when a document is ahead and continues from the newer day', async () => {
    const stale = splitDay(5);
    const caughtUp = splitDay(6);
    const loadDailyRecord = vi
      .fn<() => Promise<DailyRecord>>()
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(caughtUp);
    const { fill, completeRun } = renderFill(loadDailyRecord);
    mocks.readDocs.mockResolvedValue(docsAt(6));

    await act(async () => {
      await fill(stale);
    });

    expect(loadDailyRecord).toHaveBeenCalledTimes(2);
    expect(metaOf(mocks.runClinicalFill.mock.calls[0][0])).toEqual({ revision: 6 });
    expect(completeRun.mock.calls[0][0]).toBe(caughtUp);
  });

  it('fails closed like a record that cannot load when the day stays behind its documents', async () => {
    const stale = splitDay(5);
    const loadDailyRecord = vi.fn(async () => stale);
    const { fill, completeRun } = renderFill(loadDailyRecord);
    mocks.readDocs.mockResolvedValue(docsAt(6));

    let outcome;
    await act(async () => {
      outcome = await fill(stale);
    });

    expect(loadDailyRecord).toHaveBeenCalledTimes(2);
    expect(mocks.runClinicalFill).not.toHaveBeenCalled();
    expect(completeRun).toHaveBeenCalledWith(
      stale,
      expect.objectContaining({
        patched: 0,
        errors: [expect.objectContaining({ message: 'clinical_record_load_failed' })],
      }),
      null,
      RUN_ID
    );
    expect(outcome).toEqual({
      status: 'failed',
      retry: expect.objectContaining({
        type: 'clinical_retry',
        pendingClinicalEpisodeIds: ['ep_mother', 'ep_newborn'],
      }),
    });
  });

  it('does no extra read and passes the same record on an unmarked day', async () => {
    const unmarked = splitDay(5, false);
    const loadDailyRecord = vi.fn(async () => unmarked);
    const { fill, completeRun, patchDailyRecord } = renderFill(loadDailyRecord);

    await act(async () => {
      await fill(unmarked);
    });
    expect(await strategyInput().refreshRecord()).toBe(unmarked);
    await strategyInput().applyPatch({ patch: {}, target: { bedId: 'R1' } });

    expect(loadDailyRecord).toHaveBeenCalledTimes(2);
    expect(mocks.readDocs).not.toHaveBeenCalled();
    expect(mocks.readDoc).not.toHaveBeenCalled();
    expect(mocks.runClinicalFill.mock.calls[0][0]).toBe(unmarked);
    expect(strategyInput().record).toBe(unmarked);
    expect(patchDailyRecord.mock.calls[0][3]).toBe(unmarked);
    expect(completeRun.mock.calls[0][0]).toBe(unmarked);
  });
});
