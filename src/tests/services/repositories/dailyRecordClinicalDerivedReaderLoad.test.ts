import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The reader chunk fails to load (offline on first use, a stale hash after a deploy).
const CHUNK_ERROR = 'Failed to fetch dynamically imported module: /assets/reader-stale.js';
const loader = vi.hoisted(() => ({
  failures: 0,
  imports: 0,
  readDocs: vi.fn(),
  readDoc: vi.fn(),
  recordOperationalTelemetry: vi.fn(),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: loader.recordOperationalTelemetry,
}));
const loadReaderChunk = () => {
  loader.imports += 1;
  if (loader.failures > 0) {
    loader.failures -= 1;
    throw new Error(CHUNK_ERROR);
  }
  return {
    readClinicalDerivedEpisodeDocs: loader.readDocs,
    readClinicalDerivedEpisodeDoc: loader.readDoc,
  };
};

import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_a';
const record = {
  date: DATE,
  meta: { revision: 2 },
  clinicalDerivedLayout: { version: 1, generation: GENERATION },
  beds: { R1: { clinicalEpisodeId: 'ep_a', vitalSignsHistory: [] } },
} as unknown as DailyRecord;
const unmarked = { ...record, clinicalDerivedLayout: undefined } as DailyRecord;

// A fresh service per test: nothing cached from a previous load, and the mock reloads too.
const loadService = () => import('@/services/repositories/dailyRecordClinicalDerivedReadService');
const events = () => loader.recordOperationalTelemetry.mock.calls.map(([event]) => event);

const expectOneReaderUnavailableEvent = (readScope: 'day' | 'episode') => {
  expect(events()).toEqual([
    {
      category: 'firestore',
      operation: 'clinical_derived_read',
      status: 'degraded',
      runtimeState: 'degraded',
      date: DATE,
      issues: ['reader_unavailable'],
      context: { readScope, errorCode: 'reader_unavailable' },
    },
  ]);
  expect(sanitizeOperationalTelemetryEvent(events()[0])).toMatchObject({
    operation: 'clinical_derived_read',
    issues: ['unavailable_issue'],
    context: { readScope, errorCode: 'reader_unavailable' },
    droppedContextKeys: [],
  });
  expect(JSON.stringify(events())).not.toMatch(/fetch|stale\.js|Error/);
};

describe('clinicalDerived read service · reader chunk that fails to load', () => {
  beforeEach(() => {
    vi.resetModules();
    // Registered per test: a chunk that loaded in one test must not stay loaded in the next.
    vi.doMock('@/services/storage/firestore/clinicalDerivedEpisodeReader', loadReaderChunk);
    vi.clearAllMocks();
    Object.assign(loader, { failures: 0, imports: 0 });
  });

  afterEach(() => vi.useRealTimers());

  it('tries twice, then falls back (best effort) and reports it once, codes only', async () => {
    loader.failures = 2;
    const { readDailyRecordWithClinicalDerived } = await loadService();

    expect(await readDailyRecordWithClinicalDerived(record, { mode: 'bestEffort' })).toEqual({
      record,
      day: record,
      overlaid: false,
      fallbackReason: 'read_failed',
    });
    expect(loader.imports).toBe(2);
    expectOneReaderUnavailableEvent('day');
  });

  it('strict fails closed with one report, not a second one for the fail-closed', async () => {
    loader.failures = 2;
    const { readDailyRecordWithClinicalDerived } = await loadService();

    await expect(
      readDailyRecordWithClinicalDerived(record, { mode: 'strict' })
    ).rejects.toMatchObject({
      name: 'ClinicalDerivedReadError',
      reason: 'read_failed',
      code: 'reader_unavailable',
    });
    expectOneReaderUnavailableEvent('day');
  });

  it('the vitals window and the staff tool get a typed failure and one report each', async () => {
    const { readClinicalDerivedEpisodeForDisplay, readClinicalDerivedDayDocs } =
      await loadService();

    loader.failures = 2;
    expect(await readClinicalDerivedEpisodeForDisplay(DATE, GENERATION, 'ep_a')).toEqual({
      status: 'failed',
      code: 'reader_unavailable',
    });
    expectOneReaderUnavailableEvent('episode');

    loader.recordOperationalTelemetry.mockClear();
    loader.failures = 2;
    expect(await readClinicalDerivedDayDocs(record)).toEqual({
      status: 'unavailable',
      reason: 'read_failed',
      code: 'reader_unavailable',
    });
    expectOneReaderUnavailableEvent('day');
  });

  it('loads on the retry: the read works and nothing is reported', async () => {
    loader.failures = 1;
    loader.readDocs.mockResolvedValue({ status: 'resolved', docs: [], fromCache: false });
    const { readDailyRecordWithClinicalDerived } = await loadService();

    expect(await readDailyRecordWithClinicalDerived(record, { mode: 'strict' })).toEqual({
      record,
      day: record,
      overlaid: false,
    });
    expect(loader.imports).toBe(2);
    expect(loader.readDocs).toHaveBeenCalledTimes(1);
    expect(loader.recordOperationalTelemetry).not.toHaveBeenCalled();
  });

  it('a reader that never loaded is tried again on the next read', async () => {
    loader.failures = 2;
    loader.readDocs.mockResolvedValue({ status: 'resolved', docs: [], fromCache: false });
    const { readDailyRecordWithClinicalDerived } = await loadService();

    await readDailyRecordWithClinicalDerived(record, { mode: 'bestEffort' });
    const second = await readDailyRecordWithClinicalDerived(record, { mode: 'bestEffort' });

    expect(second.fallbackReason).toBeUndefined();
    expect(loader.imports).toBe(3);
    expect(loader.recordOperationalTelemetry).toHaveBeenCalledTimes(1);
  });

  it('an unmarked day loads nothing and reports nothing', async () => {
    loader.failures = 2;
    const service = await loadService();

    for (const mode of ['strict', 'bestEffort'] as const) {
      expect((await service.readDailyRecordWithClinicalDerived(unmarked, { mode })).record).toBe(
        unmarked
      );
    }
    expect(await service.readClinicalDerivedDayDocs(unmarked)).toEqual({ status: 'unmarked' });
    expect(loader.imports).toBe(0);
    expect(loader.recordOperationalTelemetry).not.toHaveBeenCalled();
  });

  it('the day carryover does not report again what the read service reported', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // The Rapa Nui clock reads 2026-11-03 at this instant: the only day the carryover seeds.
    vi.setSystemTime(new Date('2026-11-03T16:00:00Z'));
    loader.failures = 2;
    const { readClinicalCarryoverSource } =
      await import('@/services/repositories/clinicalDayCarryover');

    expect(await readClinicalCarryoverSource('2026-11-03', record)).toBe(record);
    expectOneReaderUnavailableEvent('day');
  });
});
