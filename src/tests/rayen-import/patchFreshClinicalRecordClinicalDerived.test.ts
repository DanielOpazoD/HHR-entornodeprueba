import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';

const mocks = vi.hoisted(() => ({
  isFirestoreEnabled: vi.fn(() => true),
  readDoc: vi.fn(),
  readDocs: vi.fn(),
  patchDailyRecordWithCompatibility: vi.fn(),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: mocks.isFirestoreEnabled,
}));
vi.mock('@/services/storage/firestore/clinicalDerivedEpisodeReader', () => ({
  readClinicalDerivedEpisodeDoc: mocks.readDoc,
  readClinicalDerivedEpisodeDocs: mocks.readDocs,
}));
vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: mocks.patchDailyRecordWithCompatibility,
}));

import { patchFreshClinicalRecord } from '@/features/rayen-import/hooks/patchFreshClinicalRecord';
import { ClinicalDerivedReadError } from '@/services/repositories/dailyRecordClinicalDerivedReadService';

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_a';
const reading = (label: string) => [{ recordedDate: DATE, recordedAt: `${DATE} 08:00`, label }];

const day = (revision: number, marked = true): DailyRecord =>
  ({
    date: DATE,
    lastUpdated: `${DATE}T10:0${revision}:00.000Z`,
    meta: { revision },
    ...(marked ? { clinicalDerivedLayout: { version: 1, generation: GENERATION } } : {}),
    beds: {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente Sintético',
        clinicalEpisodeId: 'ep_synthetic',
        vitalSignsHistory: reading('embedded'),
      },
    },
  }) as unknown as DailyRecord;

const episodeDoc = (dayRevision: number) =>
  ({
    schemaVersion: 1,
    date: DATE,
    clinicalEpisodeId: 'ep_synthetic',
    layoutGeneration: GENERATION,
    dayRevision,
    clinicalSyncCheckpoint: null,
    vitalSignsHistory: reading('document'),
  }) as unknown as ClinicalDerivedEpisodeDoc;

const target = { censusDate: DATE, bedId: 'R1', clinicalEpisodeId: 'ep_synthetic' };
const writeGuard = {
  runId: 'run-synthetic',
  importMode: 'preview' as const,
  clinicalBatchMode: 'off' as const,
  revision: 1,
  sourceDate: DATE,
  recordScope: 'run' as const,
};
const patch = { 'beds.R1.vitalSignsHistory': reading('rayen') };

/** The habitual read answers each record in turn, then keeps answering the last one. */
const repositoryWith = (...records: DailyRecord[]) => {
  const getForDateWithMeta = vi.fn().mockResolvedValue({ record: records[records.length - 1] });
  records.forEach(record => getForDateWithMeta.mockResolvedValueOnce({ record }));
  return {
    getForDateWithMeta,
    getAuthoritativeForDate: vi.fn(),
  } as unknown as DailyRecordRepositoryPort & {
    getForDateWithMeta: ReturnType<typeof vi.fn>;
    getAuthoritativeForDate: ReturnType<typeof vi.fn>;
  };
};

/** The fill computed its patch from the overlaid view: its base carries the document's history. */
const overlaidBase = (revision: number) => {
  const base = day(revision);
  base.beds.R1.vitalSignsHistory = reading('document') as never;
  return base;
};

describe('patchFreshClinicalRecord on a split day (D10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFirestoreEnabled.mockReturnValue(true);
    mocks.patchDailyRecordWithCompatibility.mockResolvedValue(undefined);
  });

  it("rebuilds against the episode's server document and writes on the un-overlaid day", async () => {
    const fresh = day(5);
    const repository = repositoryWith(fresh);
    mocks.readDoc.mockResolvedValueOnce({
      status: 'resolved',
      doc: episodeDoc(5),
      fromCache: false,
    });

    await patchFreshClinicalRecord(repository, patch, target, writeGuard, overlaidBase(5));

    expect(mocks.readDoc).toHaveBeenCalledWith(DATE, GENERATION, 'ep_synthetic', {
      source: 'server',
    });
    expect(mocks.readDocs).not.toHaveBeenCalled();
    expect(repository.getAuthoritativeForDate).not.toHaveBeenCalled();
    const [, , writtenPatch, options] = mocks.patchDailyRecordWithCompatibility.mock.calls[0];
    expect(writtenPatch).toEqual(patch);
    expect(options.baseRecord).toBe(fresh);
    expect(fresh.beds.R1.vitalSignsHistory).toEqual(reading('embedded'));
  });

  it('re-reads the day once when the document is ahead and writes on the day it rebuilt against', async () => {
    const stale = day(5);
    const caughtUp = day(7);
    const repository = repositoryWith(stale, caughtUp);
    mocks.readDoc.mockResolvedValue({ status: 'resolved', doc: episodeDoc(7), fromCache: false });

    await patchFreshClinicalRecord(repository, patch, target, writeGuard, overlaidBase(7));

    expect(repository.getForDateWithMeta).toHaveBeenCalledTimes(2);
    expect(repository.getAuthoritativeForDate).not.toHaveBeenCalled();
    expect(mocks.readDoc).toHaveBeenCalledTimes(2);
    // The server checks the exact version: the base is the re-read day, never the older one.
    const { baseRecord } = mocks.patchDailyRecordWithCompatibility.mock.calls[0][3];
    expect(baseRecord).toBe(caughtUp);
    expect(baseRecord.lastUpdated).toBe(caughtUp.lastUpdated);
    expect(baseRecord.beds.R1.vitalSignsHistory).toEqual(reading('embedded'));
  });

  it('writes nothing when the re-read day no longer holds the episode at the target bed', async () => {
    const moved = day(7);
    moved.beds.R1.clinicalEpisodeId = 'ep_other';
    const repository = repositoryWith(day(5), moved);
    mocks.readDoc.mockResolvedValue({ status: 'resolved', doc: episodeDoc(7), fromCache: false });

    await expect(
      patchFreshClinicalRecord(repository, patch, target, writeGuard, overlaidBase(7))
    ).rejects.toThrow('El paciente o su cama cambiaron');
    expect(mocks.patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
  });

  it('fails closed without writing when the re-read day is still behind', async () => {
    const repository = repositoryWith(day(5));
    mocks.readDoc.mockResolvedValue({ status: 'resolved', doc: episodeDoc(7), fromCache: false });

    const error = await patchFreshClinicalRecord(
      repository,
      patch,
      target,
      writeGuard,
      overlaidBase(5)
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ClinicalDerivedReadError);
    expect(error).toMatchObject({ reason: 'stale_day' });
    expect(mocks.patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
  });

  it('fails closed without writing when the document cannot be read', async () => {
    const repository = repositoryWith(day(5));
    mocks.readDoc.mockResolvedValue({ status: 'failed', code: 'unavailable' });

    await expect(
      patchFreshClinicalRecord(repository, patch, target, writeGuard, overlaidBase(5))
    ).rejects.toBeInstanceOf(ClinicalDerivedReadError);
    expect(mocks.patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
  });

  it('reads nothing more on an unmarked day', async () => {
    const fresh = day(5, false);
    const repository = repositoryWith(fresh);

    await patchFreshClinicalRecord(repository, patch, target, writeGuard, day(5, false));

    expect(mocks.readDoc).not.toHaveBeenCalled();
    expect(mocks.readDocs).not.toHaveBeenCalled();
    expect(repository.getAuthoritativeForDate).not.toHaveBeenCalled();
    expect(mocks.patchDailyRecordWithCompatibility.mock.calls[0][3].baseRecord).toBe(fresh);
  });
});
