import { describe, expect, it, vi } from 'vitest';

// The reader chunk fails to load once (offline on first use, a stale hash after a deploy).
const loader = vi.hoisted(() => ({ failures: 1, readDocs: vi.fn() }));

vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/storage/firestore/clinicalDerivedEpisodeReader', () => {
  if (loader.failures > 0) {
    loader.failures -= 1;
    throw new Error('Failed to fetch dynamically imported module');
  }
  return { readClinicalDerivedEpisodeDocs: loader.readDocs };
});

import {
  ClinicalDerivedReadError,
  readDailyRecordWithClinicalDerived,
} from '@/services/repositories/dailyRecordClinicalDerivedReadService';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const DATE = '2026-11-02';
const record = {
  date: DATE,
  meta: { revision: 2 },
  clinicalDerivedLayout: { version: 1, generation: 'gen_synthetic_a' },
  beds: { R1: { clinicalEpisodeId: 'ep_a', vitalSignsHistory: [] } },
} as unknown as DailyRecord;

describe('readDailyRecordWithClinicalDerived · reader chunk that fails to load', () => {
  it('falls back (best effort) or fails closed (strict), and retries the import next time', async () => {
    expect(await readDailyRecordWithClinicalDerived(record, { mode: 'bestEffort' })).toEqual({
      record,
      day: record,
      overlaid: false,
      fallbackReason: 'read_failed',
    });

    loader.failures = 1;
    const error = await readDailyRecordWithClinicalDerived(record, { mode: 'strict' }).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ClinicalDerivedReadError);
    expect(error).toMatchObject({ reason: 'read_failed', code: 'reader_unavailable' });

    loader.readDocs.mockResolvedValueOnce({ status: 'resolved', docs: [], fromCache: false });
    expect(await readDailyRecordWithClinicalDerived(record, { mode: 'strict' })).toEqual({
      record,
      day: record,
      overlaid: false,
    });
    expect(loader.readDocs).toHaveBeenCalledTimes(1);
  });
});
