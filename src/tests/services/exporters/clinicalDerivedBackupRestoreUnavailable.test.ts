/**
 * JSON import when the split-day restore cannot load (offline: it loads on demand and is not in
 * the install precache, D10 of DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md). Every day is still
 * imported; a split day is reported partial, never clean. Synthetic data only.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const mocks = vi.hoisted(() => ({ getLocal: vi.fn(), saveMany: vi.fn(), readBackup: vi.fn() }));
vi.mock('@/services/repositories/dailyRecordClinicalDerivedReadService', () => ({
  readClinicalDerivedBackupDay: mocks.readBackup,
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: mocks.getLocal,
  saveRecordsStrict: mocks.saveMany,
}));
vi.mock('@/services/exporters/clinicalDerivedBackupRestore', () => {
  throw new Error('synthetic chunk load failure');
});

import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';
import {
  buildClinicalDerivedBackupSection,
  describeIncompleteClinicalDerivedBackup,
} from '@/services/exporters/clinicalDerivedBackupSection';

const marker = { version: 1, generation: 'gen_synthetic_offline' };
const day = (date: string, extra: Record<string, unknown> = {}) =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T09:00:00.000Z`,
    nurses: ['', ''],
    activeExtraBeds: [],
    ...extra,
  }) as unknown as DailyRecord;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLocal.mockResolvedValue(null);
  mocks.saveMany.mockResolvedValue({ ok: true });
});

it('imports every day and reports the split one partial', async () => {
  const file = new File(
    [
      JSON.stringify({
        '2026-11-02': day('2026-11-02', { clinicalDerivedLayout: marker }),
        '2026-11-03': day('2026-11-03'),
        clinicalDerived: {
          '2026-11-02': { status: 'exported', layoutGeneration: marker.generation, docs: [] },
        },
      }),
    ],
    'respaldo-sintetico.json',
    { type: 'application/json' }
  );

  const result = await importDataJSONDetailed(file);

  expect(result).toMatchObject({
    success: true,
    outcome: 'partial',
    importedCount: 2,
    skippedEntries: [],
    clinicalDerivedIncompleteDates: ['2026-11-02'],
  });
  const saved = mocks.saveMany.mock.calls[0][0] as DailyRecord[];
  expect(saved.map(record => record.date).sort()).toEqual(['2026-11-02', '2026-11-03']);
});

it('retains the captured documents and warns when the export validator cannot load', async () => {
  const docs = [
    {
      schemaVersion: 1,
      date: '2026-11-02',
      clinicalEpisodeId: 'ep_synthetic_offline',
      layoutGeneration: marker.generation,
      dayRevision: 2,
      vitalSignsHistory: null,
    },
  ];
  mocks.readBackup.mockResolvedValue({
    status: 'resolved',
    layoutGeneration: marker.generation,
    docs,
  });

  const section = await buildClinicalDerivedBackupSection([
    day('2026-11-02', { clinicalDerivedLayout: marker }),
  ]);

  expect(section?.['2026-11-02']).toEqual({
    status: 'unavailable',
    reason: 'restore_unavailable',
    layoutGeneration: marker.generation,
    docs,
  });
  expect(describeIncompleteClinicalDerivedBackup(section)?.userSafeMessage).toContain('2026-11-02');
});
