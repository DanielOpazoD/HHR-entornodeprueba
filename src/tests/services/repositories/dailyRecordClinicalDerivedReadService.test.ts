import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { isFirestoreEnabled, readDocs, readDoc } = vi.hoisted(() => ({
  isFirestoreEnabled: vi.fn(() => true),
  readDocs: vi.fn(),
  readDoc: vi.fn(),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled }));
vi.mock('@/services/storage/firestore/clinicalDerivedEpisodeReader', () => ({
  readClinicalDerivedEpisodeDocs: readDocs,
  readClinicalDerivedEpisodeDoc: readDoc,
}));

import {
  ClinicalDerivedReadError,
  readDailyRecordWithClinicalDerived,
} from '@/services/repositories/dailyRecordClinicalDerivedReadService';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_a';
const reading = (label: string) => [
  { recordedDate: DATE, recordedAt: `${DATE}T08:00:00`, author: label },
];

const day = (extra: Record<string, unknown> = {}, revision = 5): DailyRecord =>
  ({
    date: DATE,
    lastUpdated: `${DATE}T10:00:00.000Z`,
    meta: { revision },
    clinicalDerivedLayout: { version: 1, generation: GENERATION },
    beds: {
      R1: {
        patientName: 'Madre Sintética',
        clinicalEpisodeId: 'ep_mother',
        vitalSignsHistory: reading('embedded-mother'),
        clinicalCrib: {
          patientName: 'RN Sintético',
          clinicalEpisodeId: 'ep_newborn',
          vitalSignsHistory: reading('embedded-newborn'),
        },
      },
    },
    ...extra,
  }) as unknown as DailyRecord;

const episodeDoc = (clinicalEpisodeId: string, dayRevision = 5) =>
  ({
    schemaVersion: 1,
    date: DATE,
    clinicalEpisodeId,
    layoutGeneration: GENERATION,
    dayRevision,
    vitalSignsHistory: reading(`doc-${clinicalEpisodeId}`),
  }) as ClinicalDerivedEpisodeDoc;

const historyOf = (record: DailyRecord, crib = false) => {
  const bed = record.beds.R1;
  return (crib ? bed.clinicalCrib : bed)?.vitalSignsHistory;
};

const resolved = (...docs: ClinicalDerivedEpisodeDoc[]) => ({ status: 'resolved', docs });

const expectFailClosed = async (promise: Promise<unknown>, reason: string, code?: string) => {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ClinicalDerivedReadError);
  expect(error).toMatchObject({ date: DATE, reason, code });
};

describe('readDailyRecordWithClinicalDerived', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFirestoreEnabled.mockReturnValue(true);
  });

  afterEach(() => {
    delete window.__HHR_E2E_OVERRIDE__;
  });

  it.each(['strict', 'bestEffort'] as const)(
    'returns the record unchanged without reads when it cannot or need not read (%s)',
    async mode => {
      const marked = day();
      isFirestoreEnabled.mockReturnValueOnce(false);
      expect(await readDailyRecordWithClinicalDerived(marked, { mode })).toEqual({
        record: marked,
        overlaid: false,
      });

      window.__HHR_E2E_OVERRIDE__ = {};
      expect((await readDailyRecordWithClinicalDerived(marked, { mode })).record).toBe(marked);
      delete window.__HHR_E2E_OVERRIDE__;

      const unmarked = day({ clinicalDerivedLayout: undefined });
      expect((await readDailyRecordWithClinicalDerived(unmarked, { mode })).record).toBe(unmarked);
      expect(readDocs).not.toHaveBeenCalled();
      expect(readDoc).not.toHaveBeenCalled();
    }
  );

  it('overlays a marked day without changing its input; best effort reads the default source', async () => {
    const record = day();
    const before = structuredClone(record);
    readDocs.mockResolvedValueOnce(resolved(episodeDoc('ep_mother'), episodeDoc('ep_newborn')));

    const result = await readDailyRecordWithClinicalDerived(record, { mode: 'bestEffort' });

    expect(readDocs).toHaveBeenCalledWith(DATE, { source: 'default' });
    expect(result.overlaid).toBe(true);
    expect(result.fallbackReason).toBeUndefined();
    expect(historyOf(result.record)).toEqual(reading('doc-ep_mother'));
    expect(historyOf(result.record, true)).toEqual(reading('doc-ep_newborn'));
    expect(record).toEqual(before);
  });

  it('strict reads always go to the server', async () => {
    readDocs.mockResolvedValueOnce(resolved(episodeDoc('ep_mother')));

    const result = await readDailyRecordWithClinicalDerived(day(), {
      mode: 'strict',
      source: 'default',
    });

    expect(readDocs).toHaveBeenCalledWith(DATE, { source: 'server' });
    expect(historyOf(result.record)).toEqual(reading('doc-ep_mother'));
    expect(historyOf(result.record, true)).toEqual(reading('embedded-newborn'));
  });

  it('reads only one episode document when the caller names the episode', async () => {
    readDoc.mockResolvedValueOnce({ status: 'resolved', doc: episodeDoc('ep_newborn') });

    const result = await readDailyRecordWithClinicalDerived(day(), {
      mode: 'strict',
      clinicalEpisodeId: 'ep_newborn',
    });

    expect(readDocs).not.toHaveBeenCalled();
    expect(readDoc).toHaveBeenCalledWith(DATE, 'ep_newborn', { source: 'server' });
    expect(historyOf(result.record, true)).toEqual(reading('doc-ep_newborn'));
    expect(historyOf(result.record)).toEqual(reading('embedded-mother'));

    readDoc.mockResolvedValueOnce({ status: 'resolved', doc: null });
    const none = await readDailyRecordWithClinicalDerived(day(), {
      mode: 'bestEffort',
      clinicalEpisodeId: 'ep_mother',
    });
    expect(none.overlaid).toBe(false);
    expect(none.fallbackReason).toBeUndefined();
  });

  it.each([
    [{ status: 'permission_denied', code: 'permission-denied' }, 'permission_denied'],
    [{ status: 'failed', code: 'unavailable' }, 'read_failed'],
  ])(
    'a failed read fails closed in strict mode and falls back in best effort',
    async (read, reason) => {
      readDocs.mockResolvedValue(read);
      const record = day();

      await expectFailClosed(
        readDailyRecordWithClinicalDerived(record, { mode: 'strict' }),
        reason,
        read.code
      );
      expect(await readDailyRecordWithClinicalDerived(record, { mode: 'bestEffort' })).toEqual({
        record,
        overlaid: false,
        fallbackReason: reason,
      });
    }
  );

  it('a marker it does not understand never reads as unmarked', async () => {
    const record = day({ clinicalDerivedLayout: { version: 2, generation: GENERATION } });

    await expectFailClosed(
      readDailyRecordWithClinicalDerived(record, { mode: 'strict' }),
      'unsupported_layout'
    );
    expect(await readDailyRecordWithClinicalDerived(record, { mode: 'bestEffort' })).toEqual({
      record,
      overlaid: false,
      fallbackReason: 'unsupported_layout',
    });
    expect(readDocs).not.toHaveBeenCalled();
  });

  it('strict: a document ahead of the day re-reads both once, then overlays the newer day', async () => {
    const newer = day({}, 6);
    const reloadRecord = vi.fn(async () => newer);
    readDocs
      .mockResolvedValueOnce(resolved(episodeDoc('ep_mother', 6)))
      .mockResolvedValueOnce(resolved(episodeDoc('ep_mother', 6)));

    const result = await readDailyRecordWithClinicalDerived(day(), {
      mode: 'strict',
      reloadRecord,
    });

    expect(reloadRecord).toHaveBeenCalledTimes(1);
    expect(readDocs).toHaveBeenCalledTimes(2);
    expect((result.record as DailyRecord & { meta: { revision: number } }).meta.revision).toBe(6);
    expect(historyOf(result.record)).toEqual(reading('doc-ep_mother'));
  });

  it('strict: fails closed when the day is still behind after one re-read, or cannot re-read', async () => {
    readDocs.mockResolvedValue(resolved(episodeDoc('ep_mother', 7)));
    const reloadRecord = vi.fn(async () => day({}, 6));

    await expectFailClosed(
      readDailyRecordWithClinicalDerived(day(), { mode: 'strict', reloadRecord }),
      'stale_day'
    );
    expect(reloadRecord).toHaveBeenCalledTimes(1);
    expect(readDocs).toHaveBeenCalledTimes(2);

    await expectFailClosed(
      readDailyRecordWithClinicalDerived(day(), { mode: 'strict' }),
      'stale_day'
    );
    await expectFailClosed(
      readDailyRecordWithClinicalDerived(day(), { mode: 'strict', reloadRecord: async () => null }),
      'stale_day'
    );
  });

  it('strict: a re-read day that is no longer marked comes back as read', async () => {
    readDocs.mockResolvedValueOnce(resolved(episodeDoc('ep_mother', 6)));
    const recreated = day({ clinicalDerivedLayout: undefined }, 1);

    const result = await readDailyRecordWithClinicalDerived(day(), {
      mode: 'strict',
      reloadRecord: async () => recreated,
    });

    expect(result).toEqual({ record: recreated, overlaid: false });
    expect(readDocs).toHaveBeenCalledTimes(1);
  });

  it('best effort shows a document newer than the cached day without re-reading it', async () => {
    readDocs.mockResolvedValueOnce(resolved(episodeDoc('ep_mother', 9)));
    const reloadRecord = vi.fn();

    const result = await readDailyRecordWithClinicalDerived(day(), {
      mode: 'bestEffort',
      reloadRecord,
    });

    expect(reloadRecord).not.toHaveBeenCalled();
    expect(historyOf(result.record)).toEqual(reading('doc-ep_mother'));
  });

  it('an episode active twice fails closed in strict mode; best effort overlays the rest', async () => {
    const record = day({
      beds: {
        R1: { clinicalEpisodeId: 'ep_dup', vitalSignsHistory: reading('embedded-1') },
        R2: { clinicalEpisodeId: 'ep_dup', vitalSignsHistory: reading('embedded-2') },
        R3: { clinicalEpisodeId: 'ep_mother', vitalSignsHistory: reading('embedded-3') },
      },
    });
    readDocs.mockResolvedValue(resolved(episodeDoc('ep_dup'), episodeDoc('ep_mother')));

    await expectFailClosed(
      readDailyRecordWithClinicalDerived(record, { mode: 'strict' }),
      'duplicate_episode'
    );
    const result = await readDailyRecordWithClinicalDerived(record, { mode: 'bestEffort' });
    expect(result.fallbackReason).toBe('duplicate_episode');
    expect(result.overlaid).toBe(true);
    expect(result.record.beds.R1.vitalSignsHistory).toEqual(reading('embedded-1'));
    expect(result.record.beds.R3.vitalSignsHistory).toEqual(reading('doc-ep_mother'));
  });
});
