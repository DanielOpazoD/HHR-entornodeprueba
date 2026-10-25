/**
 * JSON import on split days (D10 of DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md): an import
 * never replaces a newer (or the same) local split day with a copy that lost or changed its marker,
 * and a local day it cannot read counts as possibly split; the date is reported as skipped.
 * Unmarked local days import exactly as before. Synthetic data only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const mocks = vi.hoisted(() => ({ getLocal: vi.fn(), saveMany: vi.fn() }));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: mocks.getLocal,
  saveRecordsStrict: mocks.saveMany,
}));

import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';

const marker = { version: 1, generation: 'gen_synthetic_a' };
const day = (date: string, lastUpdated: string, extra: Record<string, unknown> = {}) =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated,
    nurses: ['', ''],
    activeExtraBeds: [],
    ...extra,
  }) as unknown as DailyRecord;
const file = (entries: Record<string, unknown>) =>
  new File([JSON.stringify(entries)], 'respaldo-sintetico.json', { type: 'application/json' });
const savedDates = () => (mocks.saveMany.mock.calls[0]?.[0] as DailyRecord[]).map(r => r.date);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveMany.mockResolvedValue({
    ok: true,
    operation: 'save_many',
    store: 'indexeddb',
    dates: [],
  });
});

describe('JSON import over local split days', () => {
  it('skips an older unmarked copy of a local split day and imports the rest', async () => {
    const localSplit = day('2026-11-02', '2026-11-02T12:00:00.000Z', {
      clinicalDerivedLayout: marker,
    });
    mocks.getLocal.mockImplementation(async (date: string) =>
      date === '2026-11-02' ? localSplit : null
    );

    const result = await importDataJSONDetailed(
      file({
        '2026-11-02': day('2026-11-02', '2026-11-02T09:00:00.000Z'),
        '2026-11-03': day('2026-11-03', '2026-11-03T09:00:00.000Z'),
      })
    );

    expect(result).toMatchObject({
      success: true,
      outcome: 'partial',
      importedCount: 1,
      skippedEntries: ['2026-11-02'],
    });
    expect(savedDates()).toEqual(['2026-11-03']);
  });

  it('blocks when every entry would replace a newer local split day', async () => {
    mocks.getLocal.mockResolvedValue(
      day('2026-11-02', '2026-11-02T12:00:00.000Z', { clinicalDerivedLayout: marker })
    );

    const result = await importDataJSONDetailed(
      file({ '2026-11-02': day('2026-11-02', '2026-11-02T12:00:00.000Z') })
    );

    expect(result).toMatchObject({ success: false, outcome: 'blocked', importedCount: 0 });
    expect(mocks.saveMany).not.toHaveBeenCalled();
  });

  it.each([
    ['an unmarked copy', {}],
    [
      'a copy from another generation',
      { clinicalDerivedLayout: { version: 1, generation: 'gen_b' } },
    ],
  ])('skips %s that is not newer than the local split day', async (_label, extra) => {
    mocks.getLocal.mockResolvedValue(
      day('2026-11-02', '2026-11-02T12:00:00.000Z', { clinicalDerivedLayout: marker })
    );

    const result = await importDataJSONDetailed(
      file({
        '2026-11-02': day('2026-11-02', '2026-11-02T11:00:00.000Z', extra),
        '2026-11-03': day('2026-11-03', '2026-11-03T09:00:00.000Z'),
      })
    );

    expect(result).toMatchObject({ outcome: 'partial', skippedEntries: ['2026-11-02'] });
    expect(savedDates()).toEqual(['2026-11-03']);
  });

  it('skips a date whose local copy cannot be read instead of treating it as absent', async () => {
    mocks.getLocal.mockImplementation(async (date: string) => {
      if (date === '2026-11-02') throw new Error('synthetic IndexedDB failure');
      return null;
    });

    const result = await importDataJSONDetailed(
      file({
        '2026-11-02': day('2026-11-02', '2026-11-02T09:00:00.000Z'),
        '2026-11-03': day('2026-11-03', '2026-11-03T09:00:00.000Z'),
      })
    );

    expect(result).toMatchObject({ outcome: 'partial', skippedEntries: ['2026-11-02'] });
    expect(savedDates()).toEqual(['2026-11-03']);
  });

  it.each([
    ['a strictly newer unmarked copy', '2026-11-02T13:00:00.000Z', {}, {}],
    [
      // The export writes a section entry for every marked day; this one has no episode documents.
      'a copy that keeps its marker',
      '2026-11-02T09:00:00.000Z',
      { clinicalDerivedLayout: marker },
      {
        clinicalDerived: {
          '2026-11-02': { status: 'exported', layoutGeneration: marker.generation, docs: [] },
        },
      },
    ],
  ])('imports %s', async (_label, lastUpdated, extra, section) => {
    mocks.getLocal.mockResolvedValue(
      day('2026-11-02', '2026-11-02T12:00:00.000Z', { clinicalDerivedLayout: marker })
    );

    const result = await importDataJSONDetailed(
      file({ '2026-11-02': day('2026-11-02', lastUpdated, extra), ...section })
    );

    expect(result).toMatchObject({ success: true, outcome: 'clean', importedCount: 1 });
    expect(savedDates()).toEqual(['2026-11-02']);
  });

  it('imports a copy that keeps its marker but without its section entry as partial', async () => {
    mocks.getLocal.mockResolvedValue(
      day('2026-11-02', '2026-11-02T12:00:00.000Z', { clinicalDerivedLayout: marker })
    );

    const result = await importDataJSONDetailed(
      file({
        '2026-11-02': day('2026-11-02', '2026-11-02T09:00:00.000Z', {
          clinicalDerivedLayout: marker,
        }),
      })
    );

    expect(result).toMatchObject({
      success: true,
      outcome: 'partial',
      importedCount: 1,
      skippedEntries: [],
      clinicalDerivedIncompleteDates: ['2026-11-02'],
    });
    expect(savedDates()).toEqual(['2026-11-02']);
  });
});

describe('JSON import over unmarked local days', () => {
  it('replaces a newer unmarked local day as before', async () => {
    mocks.getLocal.mockResolvedValue(day('2026-11-02', '2026-11-02T12:00:00.000Z'));

    const result = await importDataJSONDetailed(
      file({ '2026-11-02': day('2026-11-02', '2026-11-02T09:00:00.000Z') })
    );

    expect(result).toMatchObject({ success: true, outcome: 'clean', importedCount: 1 });
    expect(savedDates()).toEqual(['2026-11-02']);
  });
});
