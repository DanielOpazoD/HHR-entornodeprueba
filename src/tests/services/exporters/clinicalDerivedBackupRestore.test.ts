/**
 * Restoring a split day from a JSON backup (D10 and D14 of DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md):
 * each episode's vitals history and Rayen checkpoint come back from the backup's `clinicalDerived`
 * section, embedded in the holders of that same episode (never by bed), so mother and newborn stay
 * apart and a discharged episode keeps its own. Synthetic data only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';

const mocks = vi.hoisted(() => ({
  getLocal: vi.fn(),
  saveMany: vi.fn(),
  saveRemote: vi.fn(),
  readDayDocs: vi.fn(),
  readDaySnapshot: vi.fn(),
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: mocks.getLocal,
  saveRecordsStrict: mocks.saveMany,
}));
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  saveDetailed: mocks.saveRemote,
}));
// The read service over the fake server below: the restore confirms what it holds.
vi.mock('@/services/repositories/dailyRecordClinicalDerivedReadService', () => ({
  readClinicalDerivedDayDocs: mocks.readDayDocs,
  readClinicalDerivedDaySnapshot: mocks.readDaySnapshot,
}));
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: () => 'admin@example.invalid',
}));

import { importRecordsFromBackup } from '@/services/admin/dataMaintenanceService';
import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';
import { readClinicalDerivedLayout } from '@/services/storage/clinicalDerivedContract';
import {
  DATE,
  NEW_LAYOUT,
  checkpoint,
  doc,
  monthBackup,
  patient,
  reading,
  section,
  splitDay,
  withoutMovedFields,
  type Section,
} from '@/tests/services/exporters/clinicalDerivedBackupRestore.test-support';

const expectEpisodesBack = (record: DailyRecord) => {
  expect(record.beds.R1).toMatchObject({
    rut: '11.111.111-1',
    vitalSignsHistory: [reading(80)],
    clinicalSyncCheckpoint: checkpoint('m'),
  });
  expect(record.beds.R1.clinicalCrib).toMatchObject({
    rut: 'XK1234567',
    documentType: 'Pasaporte',
    vitalSignsHistory: [reading(140)],
  });
  expect(record.beds.R1.clinicalCrib).not.toHaveProperty('clinicalSyncCheckpoint');
  expect(record.beds.R2).toMatchObject({
    rut: 'AB123456',
    vitalSignsHistory: [reading(70)],
    clinicalSyncCheckpoint: checkpoint('p'),
  });
  expect(record.discharges[0].originalData).toMatchObject({
    clinicalEpisodeId: 'ep_alta_3',
    vitalSignsHistory: [reading(66)],
    clinicalSyncCheckpoint: checkpoint('a'),
  });
  expect(record.beds.R4).not.toHaveProperty('vitalSignsHistory');
};

/** The server: the day it holds (set by the save) and the episode documents under it. */
let serverDay: DailyRecord | null = null;
let serverDocs: unknown[] = [];

/** The documents of `day`'s generation, as the reader returns them. */
const serverDocsOf = (day: DailyRecord) => {
  const layout = readClinicalDerivedLayout(day);
  return layout.status === 'marked'
    ? serverDocs.filter(
        item =>
          typeof item === 'object' &&
          item !== null &&
          'layoutGeneration' in item &&
          item.layoutGeneration === layout.layout.generation
      )
    : [];
};

beforeEach(() => {
  vi.clearAllMocks();
  serverDay = null;
  serverDocs = [];
  mocks.getLocal.mockResolvedValue(null);
  mocks.saveMany.mockResolvedValue({ ok: true });
  mocks.saveRemote.mockResolvedValue(undefined);
  mocks.readDayDocs.mockImplementation(async (day: DailyRecord) => {
    const layout = readClinicalDerivedLayout(day);
    if (layout.status === 'unmarked') return { status: 'unmarked' };
    if (layout.status === 'unsupported') {
      return { status: 'unavailable', reason: 'unsupported_layout' };
    }
    return {
      status: 'resolved',
      layoutGeneration: layout.layout.generation,
      docs: serverDocsOf(day),
    };
  });
  mocks.readDaySnapshot.mockImplementation(async () =>
    serverDay
      ? { status: 'resolved', day: serverDay, docs: serverDocsOf(serverDay) }
      : { status: 'missing' }
  );
});

describe('restoring the per-episode data of a split day', () => {
  it('the monthly restore saves each episode with its own history and checkpoint', async () => {
    await importRecordsFromBackup({
      version: '1.0',
      exportDate: `${DATE}T13:00:00.000Z`,
      year: 2026,
      month: 11,
      recordCount: 1,
      records: [splitDay()],
      clinicalDerived: section() as never,
    });

    expect(mocks.saveRemote).toHaveBeenCalledTimes(1);
    const [saved, , options] = mocks.saveRemote.mock.calls[0];
    expect(options).toMatchObject({ writeOrigin: 'backup_restore' });
    expectEpisodesBack(saved as DailyRecord);
  });

  it('the local JSON import stores each episode with its own history and checkpoint', async () => {
    const file = new File(
      [JSON.stringify({ [DATE]: splitDay(), clinicalDerived: section() })],
      'respaldo-sintetico.json',
      { type: 'application/json' }
    );

    const result = await importDataJSONDetailed(file);

    expect(result).toMatchObject({ success: true, importedCount: 1, skippedEntries: [] });
    const [saved] = mocks.saveMany.mock.calls[0][0] as DailyRecord[];
    expectEpisodesBack(saved);
  });

  it('leaves a day the section does not cover exactly as backed up', async () => {
    const unmarked = DataFactory.createMockDailyRecord('2026-11-01', {
      lastUpdated: '2026-11-01T12:00:00.000Z',
      beds: {
        ...DataFactory.createMockDailyRecord('2026-11-01').beds,
        R1: patient('R1', { clinicalEpisodeId: 'ep_madre_1', vitalSignsHistory: [reading(75)] }),
      },
    });
    const file = new File(
      [JSON.stringify({ '2026-11-01': unmarked, clinicalDerived: section() })],
      'respaldo-sintetico.json',
      { type: 'application/json' }
    );

    await importDataJSONDetailed(file);

    const [saved] = mocks.saveMany.mock.calls[0][0] as DailyRecord[];
    expect(saved.beds.R1.vitalSignsHistory).toMatchObject([{ recordedDate: DATE, heartRate: 75 }]);
    expect(saved.beds.R1).not.toHaveProperty('clinicalSyncCheckpoint');
  });
});

/** The repository save: the server stores and confirms `confirm(sent)`. */
const serverConfirms = (confirm: (sent: DailyRecord) => DailyRecord) =>
  mocks.saveRemote.mockImplementation(async (sent: DailyRecord) => {
    serverDay = confirm(sent);
    return {
      outcome: 'clean',
      savedLocally: true,
      savedRemotely: true,
      confirmedRecord: serverDay,
    };
  });

describe('reporting a restore whose per-episode data did not come back', () => {
  it('is clean when the server recreates the day with the embedded values', async () => {
    serverConfirms(sent => ({ ...sent, clinicalDerivedLayout: NEW_LAYOUT }));

    const result = await importRecordsFromBackup(monthBackup([splitDay()]));

    expect(result).toEqual({ success: 1, failed: 0, repaired: 0, outcome: 'clean' });
  });

  it('is clean when the server keeps the stored split day and its episode documents', async () => {
    serverConfirms(sent => withoutMovedFields(sent));
    serverDocs = section()[DATE].docs;

    const result = await importRecordsFromBackup(monthBackup([splitDay()]));

    expect(result.outcome).toBe('clean');
  });

  it.each<[string, (sent: DailyRecord) => DailyRecord, () => unknown[]]>([
    [
      'keeps the stored split day without an episode document',
      sent => withoutMovedFields(sent),
      () => section()[DATE].docs.filter(item => item.clinicalEpisodeId !== 'ep_pasaporte_2'),
    ],
    [
      'keeps the stored split day with a document that holds other values',
      sent => withoutMovedFields(sent),
      () =>
        section()[DATE].docs.map(item =>
          item.clinicalEpisodeId === 'ep_pasaporte_2'
            ? { ...item, vitalSignsHistory: [reading(199)] }
            : item
        ),
    ],
    [
      'keeps a stored day of another generation with other embedded values',
      sent => {
        const kept = structuredClone(sent);
        kept.clinicalDerivedLayout = { version: 1, generation: 'gen_synthetic_stored' };
        kept.beds.R2.vitalSignsHistory = [reading(199)];
        kept.beds.R2.clinicalSyncCheckpoint = checkpoint('unrelated');
        return kept;
      },
      () => [],
    ],
  ])('is partial when the server %s', async (_label, confirm, docs) => {
    serverConfirms(confirm);
    serverDocs = docs();

    const result = await importRecordsFromBackup(monthBackup([splitDay()]));

    expect(result).toEqual({
      success: 1,
      failed: 0,
      repaired: 0,
      outcome: 'partial',
      clinicalDerivedIncompleteDates: [DATE],
    });
  });

  it('is partial when the saved day’s episode documents cannot be read', async () => {
    serverConfirms(sent => withoutMovedFields(sent));
    serverDocs = section()[DATE].docs;
    mocks.readDayDocs.mockResolvedValue({ status: 'unavailable', reason: 'read_failed' });
    mocks.readDaySnapshot.mockResolvedValue({ status: 'unavailable', reason: 'read_failed' });

    const result = await importRecordsFromBackup(monthBackup([splitDay()]));

    expect(result).toMatchObject({ outcome: 'partial', clinicalDerivedIncompleteDates: [DATE] });
  });

  it('is partial when another writer recreates the day with other values after the save', async () => {
    const otherGeneration = 'gen_synthetic_after_save';
    mocks.saveRemote.mockImplementation(async (sent: DailyRecord) => {
      // The save confirms the day recreated with the embedded values...
      const confirmedRecord = { ...sent, clinicalDerivedLayout: NEW_LAYOUT };
      // ...then another writer recreates it: R2's episode keeps other values in its document.
      const recreated = structuredClone(confirmedRecord);
      recreated.clinicalDerivedLayout = { version: 1, generation: otherGeneration };
      delete recreated.beds.R2.vitalSignsHistory;
      delete recreated.beds.R2.clinicalSyncCheckpoint;
      serverDay = recreated;
      serverDocs = [
        doc('ep_pasaporte_2', {
          layoutGeneration: otherGeneration,
          vitalSignsHistory: [reading(199)],
          clinicalSyncCheckpoint: checkpoint('unrelated'),
        }),
      ];
      return { outcome: 'clean', savedLocally: true, savedRemotely: true, confirmedRecord };
    });

    const result = await importRecordsFromBackup(monthBackup([splitDay()]));

    expect(result).toEqual({
      success: 1,
      failed: 0,
      repaired: 0,
      outcome: 'partial',
      clinicalDerivedIncompleteDates: [DATE],
    });
  });

  it('is partial when the server no longer has the day it confirmed', async () => {
    // Confirmed with the embedded values, then deleted before the restore checks it.
    mocks.saveRemote.mockImplementation(async (sent: DailyRecord) => ({
      outcome: 'clean',
      savedLocally: true,
      savedRemotely: true,
      confirmedRecord: { ...sent, clinicalDerivedLayout: NEW_LAYOUT },
    }));

    const result = await importRecordsFromBackup(monthBackup([splitDay()]));

    expect(result).toMatchObject({ outcome: 'partial', clinicalDerivedIncompleteDates: [DATE] });
  });

  it('is partial when the server drops the embedded values of a recreated day', async () => {
    serverConfirms(sent => ({ ...withoutMovedFields(sent), clinicalDerivedLayout: NEW_LAYOUT }));

    const result = await importRecordsFromBackup(monthBackup([splitDay()]));

    expect(result).toEqual({
      success: 1,
      failed: 0,
      repaired: 0,
      outcome: 'partial',
      clinicalDerivedIncompleteDates: [DATE],
    });
  });

  it('is partial when the restored day did not reach the server', async () => {
    mocks.saveRemote.mockResolvedValue({
      outcome: 'queued',
      savedLocally: true,
      savedRemotely: false,
      queuedForRetry: true,
    });

    const result = await importRecordsFromBackup(monthBackup([splitDay()]));

    expect(result).toMatchObject({ outcome: 'partial', clinicalDerivedIncompleteDates: [DATE] });
  });

  it.each<[string, (value: Section) => unknown]>([
    [
      'the backup could not read the day',
      () => ({ [DATE]: { status: 'unavailable', reason: 'read_failed' } }),
    ],
    [
      'a document belongs to an episode the day does not hold',
      value => {
        value[DATE].docs.push(doc('ep_ausente_9', { vitalSignsHistory: [reading(60)] }));
        return value;
      },
    ],
    [
      'a document is malformed',
      value => {
        value[DATE].docs[0] = { ...value[DATE].docs[0], dayRevision: -1 };
        return value;
      },
    ],
    [
      'the section is from another generation',
      value => ({ [DATE]: { ...value[DATE], layoutGeneration: 'gen_synthetic_other' } }),
    ],
  ])('is partial when %s', async (_label, edit) => {
    serverConfirms(sent => ({ ...sent, clinicalDerivedLayout: NEW_LAYOUT }));

    const result = await importRecordsFromBackup(monthBackup([splitDay()], edit(section())));

    expect(result).toMatchObject({
      success: 1,
      outcome: 'partial',
      clinicalDerivedIncompleteDates: [DATE],
    });
    expect(mocks.saveRemote).toHaveBeenCalledTimes(1);
  });

  it('lists only the days that lost their per-episode data', async () => {
    serverConfirms(sent => ({ ...sent, clinicalDerivedLayout: NEW_LAYOUT }));
    const other = { ...splitDay(), date: '2026-11-03' };

    const result = await importRecordsFromBackup(
      monthBackup([splitDay(), other], {
        ...section(),
        '2026-11-03': { status: 'unavailable', reason: 'permission_denied' },
      })
    );

    expect(result).toMatchObject({
      success: 2,
      outcome: 'partial',
      clinicalDerivedIncompleteDates: ['2026-11-03'],
    });
  });

  it('the local JSON import reports a day it could not complete as partial', async () => {
    const file = new File(
      [
        JSON.stringify({
          [DATE]: splitDay(),
          clinicalDerived: { [DATE]: { status: 'unavailable', reason: 'read_failed' } },
        }),
      ],
      'respaldo-sintetico.json',
      { type: 'application/json' }
    );

    const result = await importDataJSONDetailed(file);

    expect(result).toMatchObject({
      success: true,
      outcome: 'partial',
      importedCount: 1,
      skippedEntries: [],
      clinicalDerivedIncompleteDates: [DATE],
    });
  });

  it('the local JSON import of a complete section is clean', async () => {
    const file = new File(
      [JSON.stringify({ [DATE]: splitDay(), clinicalDerived: section() })],
      'respaldo-sintetico.json',
      { type: 'application/json' }
    );

    const result = await importDataJSONDetailed(file);

    expect(result).toEqual({
      success: true,
      outcome: 'clean',
      importedCount: 1,
      repairedCount: 0,
      skippedEntries: [],
    });
  });
});
