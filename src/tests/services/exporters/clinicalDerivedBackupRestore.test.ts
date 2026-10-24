/**
 * Restoring a split day from a JSON backup (D10 and D14 of DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md):
 * each episode's vitals history and Rayen checkpoint come back from the backup's `clinicalDerived`
 * section, embedded in the holders of that same episode (never by bed), so mother and newborn stay
 * apart and a discharged episode keeps its own. Synthetic data only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import { DataFactory } from '@/tests/factories/DataFactory';

const mocks = vi.hoisted(() => ({
  getLocal: vi.fn(),
  saveMany: vi.fn(),
  saveRemote: vi.fn(),
  readDayDocs: vi.fn(),
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: mocks.getLocal,
  saveRecordsStrict: mocks.saveMany,
}));
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  saveDetailed: mocks.saveRemote,
}));
// The server's episode documents of the day the restore saved, read to confirm it.
vi.mock('@/services/repositories/dailyRecordClinicalDerivedReadService', () => ({
  readClinicalDerivedDayDocs: mocks.readDayDocs,
}));
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: () => 'admin@example.invalid',
}));

import { importRecordsFromBackup } from '@/services/admin/dataMaintenanceService';
import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';
import { restoreClinicalDerivedBackupDay } from '@/services/exporters/clinicalDerivedBackupRestore';

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_restore';
const reading = (heartRate: number): PatientVitalSigns => ({
  recordedDate: DATE,
  recordedAt: `${DATE} 08:00`,
  systolic: null,
  diastolic: null,
  heartRate,
  spo2: null,
  temperature: null,
  respiratoryRate: null,
  painEva: null,
  hgt: null,
  insulinUnits: null,
  insulinQuadrant: null,
  observations: null,
  author: 'TENS Sintética',
  authorRole: 'TENS',
});
const checkpoint = (watermark: string) => ({
  version: 3,
  fingerprintVersion: 1,
  sources: { vitals: { watermark } },
});
const doc = (clinicalEpisodeId: string, fields: Record<string, unknown>, bedId = 'R4') => ({
  schemaVersion: 1,
  date: DATE,
  clinicalEpisodeId,
  layoutGeneration: GENERATION,
  target: 'bed',
  bedId,
  dayRevision: 4,
  lastMutationId: 'synthetic',
  ...fields,
});

const patient = (bedId: string, overrides: Partial<PatientData>): PatientData => {
  const value = DataFactory.createMockPatient(bedId);
  delete value.vitalSignsHistory;
  delete value.clinicalSyncCheckpoint;
  return { ...value, ...overrides };
};

/** The split day as backed up: its split episodes keep nothing embedded. */
const splitDay = (): DailyRecord => {
  const mother = patient('R1', {
    patientName: 'Madre Sintética',
    rut: '11.111.111-1',
    clinicalEpisodeId: 'ep_madre_1',
    clinicalCrib: patient('R1', {
      patientName: 'RN Sintético',
      rut: 'XK1234567',
      documentType: 'Pasaporte',
      clinicalEpisodeId: 'ep_rn_1',
    }),
  });
  const moved = patient('R2', {
    patientName: 'Paciente Pasaporte',
    rut: 'AB123456',
    documentType: 'Pasaporte',
    clinicalEpisodeId: 'ep_pasaporte_2',
  });
  const discharged = patient('R3', {
    patientName: 'Alta Sintética',
    rut: '22.222.222-2',
    clinicalEpisodeId: 'ep_alta_3',
  });
  return DataFactory.createMockDailyRecord(DATE, {
    lastUpdated: `${DATE}T12:00:00.000Z`,
    beds: { ...DataFactory.createMockDailyRecord(DATE).beds, R1: mother, R2: moved },
    discharges: [
      DataFactory.createMockDischarge({
        bedId: 'R3',
        patientName: 'Alta Sintética',
        clinicalEpisodeId: 'ep_alta_3',
        originalData: discharged,
      }),
    ],
    clinicalDerivedLayout: { version: 1, generation: GENERATION },
  });
};

const section = () => ({
  [DATE]: {
    status: 'exported',
    layoutGeneration: GENERATION,
    docs: [
      doc('ep_madre_1', {
        vitalSignsHistory: [reading(80)],
        clinicalSyncCheckpoint: checkpoint('m'),
      }),
      doc('ep_rn_1', { vitalSignsHistory: [reading(140)], clinicalSyncCheckpoint: null }),
      // Moved to R2 since the document's last write: matched by episode, never by bed.
      doc('ep_pasaporte_2', {
        vitalSignsHistory: [reading(70)],
        clinicalSyncCheckpoint: checkpoint('p'),
      }),
      doc('ep_alta_3', {
        vitalSignsHistory: [reading(66)],
        clinicalSyncCheckpoint: checkpoint('a'),
      }),
    ],
  },
});

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

/** The episode documents the server holds for the saved day's current generation. */
let serverDocs: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  serverDocs = [];
  mocks.getLocal.mockResolvedValue(null);
  mocks.saveMany.mockResolvedValue({ ok: true });
  mocks.saveRemote.mockResolvedValue(undefined);
  mocks.readDayDocs.mockImplementation(async (day: DailyRecord) =>
    day.clinicalDerivedLayout
      ? {
          status: 'resolved',
          layoutGeneration: day.clinicalDerivedLayout.generation,
          docs: serverDocs,
        }
      : { status: 'unmarked' }
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

type Section = ReturnType<typeof section>;
const monthBackup = (records: DailyRecord[], clinicalDerived: unknown = section()) => ({
  version: '1.0',
  exportDate: `${DATE}T13:00:00.000Z`,
  year: 2026,
  month: 11,
  recordCount: records.length,
  records,
  clinicalDerived: clinicalDerived as never,
});

const stripMoved = <T extends PatientData | undefined>(holder: T): T => {
  if (!holder) return holder;
  const copy: PatientData = { ...holder };
  delete copy.vitalSignsHistory;
  delete copy.clinicalSyncCheckpoint;
  return copy as T;
};
/** The day as a server that kept none of the embedded per-episode values would confirm it. */
const withoutMovedFields = (record: DailyRecord): DailyRecord => ({
  ...record,
  beds: Object.fromEntries(
    Object.entries(record.beds).map(([bedId, bed]) => [
      bedId,
      {
        ...stripMoved(bed),
        ...(bed.clinicalCrib ? { clinicalCrib: stripMoved(bed.clinicalCrib) } : {}),
      },
    ])
  ),
  discharges: record.discharges.map(movement => ({
    ...movement,
    originalData: stripMoved(movement.originalData),
  })),
});
const NEW_LAYOUT = { version: 1, generation: 'gen_synthetic_recreated' };
/** The repository save: the server confirms `confirm(sent)`. */
const serverConfirms = (confirm: (sent: DailyRecord) => DailyRecord) =>
  mocks.saveRemote.mockImplementation(async (sent: DailyRecord) => ({
    outcome: 'clean',
    savedLocally: true,
    savedRemotely: true,
    confirmedRecord: confirm(sent),
  }));

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
    mocks.readDayDocs.mockResolvedValue({ status: 'unavailable', reason: 'read_failed' });

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

describe('restoring a split day whose backup has no section entry for it', () => {
  it.each([
    ['omitted', undefined],
    ['null', null],
    ['empty', {}],
  ])('the monthly restore is partial when the section is %s', async (_label, missing) => {
    serverConfirms(sent => ({ ...sent, clinicalDerivedLayout: NEW_LAYOUT }));

    const result = await importRecordsFromBackup({
      ...monthBackup([splitDay()]),
      clinicalDerived: missing as never,
    });

    expect(result).toEqual({
      success: 1,
      failed: 0,
      repaired: 0,
      outcome: 'partial',
      clinicalDerivedIncompleteDates: [DATE],
    });
    // The day itself is still restored, as backed up.
    const [saved] = mocks.saveRemote.mock.calls[0] as [DailyRecord];
    expect(saved.beds.R2).toMatchObject({ rut: 'AB123456', clinicalEpisodeId: 'ep_pasaporte_2' });
    expect(saved.beds.R2).not.toHaveProperty('vitalSignsHistory');
  });

  it('the local JSON import is partial without the section', async () => {
    const file = new File([JSON.stringify({ [DATE]: splitDay() })], 'respaldo-sintetico.json', {
      type: 'application/json',
    });

    const result = await importDataJSONDetailed(file);

    expect(result).toMatchObject({
      success: true,
      outcome: 'partial',
      importedCount: 1,
      skippedEntries: [],
      clinicalDerivedIncompleteDates: [DATE],
    });
  });

  it('an unmarked day without the section stays clean', async () => {
    serverConfirms(sent => sent);
    const unmarked: DailyRecord = { ...splitDay(), clinicalDerivedLayout: undefined };

    const result = await importRecordsFromBackup({
      ...monthBackup([unmarked]),
      clinicalDerived: undefined,
    });

    expect(result).toEqual({ success: 1, failed: 0, repaired: 0, outcome: 'clean' });
  });
});

describe('an episode id more than one holder of the day carries', () => {
  /** A discharge snapshot of another patient that carries `ep_alta_3` too. */
  const otherSnapshot = (day: DailyRecord) => {
    const other = structuredClone(day.discharges[0]);
    other.id = 'alta-sintetica-2';
    other.patientName = 'Otra Alta Sintética';
    other.originalData = patient('R3', { rut: '33.333.333-3', clinicalEpisodeId: 'ep_alta_3' });
    return other;
  };

  it.each<[string, (day: DailyRecord) => DailyRecord]>([
    [
      'two discharge snapshots',
      day => ({ ...day, discharges: [...day.discharges, otherSnapshot(day)] }),
    ],
    [
      'a discharge and a transfer snapshot',
      day => ({
        ...day,
        transfers: [
          DataFactory.createMockTransfer({
            bedId: 'R5',
            patientName: 'Traslado Sintético',
            clinicalEpisodeId: 'ep_alta_3',
            originalData: patient('R5', { rut: '33.333.333-3', clinicalEpisodeId: 'ep_alta_3' }),
          }),
        ],
      }),
    ],
    [
      'a bed patient and a discharge snapshot',
      day => ({
        ...day,
        beds: {
          ...day.beds,
          R4: patient('R4', { rut: '33.333.333-3', clinicalEpisodeId: 'ep_alta_3' }),
        },
      }),
    ],
  ])('gives the document to none of %s and reports the day partial', async (_label, edit) => {
    serverConfirms(sent => ({ ...sent, clinicalDerivedLayout: NEW_LAYOUT }));

    const result = await importRecordsFromBackup(monthBackup([edit(splitDay())]));

    expect(result).toMatchObject({ outcome: 'partial', clinicalDerivedIncompleteDates: [DATE] });
    const [saved] = mocks.saveRemote.mock.calls[0] as [DailyRecord];
    const holders = [
      ...Object.values(saved.beds),
      ...[...saved.discharges, ...saved.transfers].map(movement => movement.originalData),
    ].filter(holder => holder?.clinicalEpisodeId === 'ep_alta_3');
    expect(holders.map(holder => holder?.rut).sort()).toEqual(['22.222.222-2', '33.333.333-3']);
    holders.forEach(holder => {
      expect(holder).not.toHaveProperty('vitalSignsHistory');
      expect(holder).not.toHaveProperty('clinicalSyncCheckpoint');
    });
    // The other episodes still get their own.
    expect(saved.beds.R2.vitalSignsHistory).toEqual([reading(70)]);
  });

  it('gives the document to neither of two bed patients with the same episode', () => {
    const day = splitDay();
    day.beds.R4 = { ...day.beds.R2, bedId: 'R4', rut: '33.333.333-3' };

    const restored = restoreClinicalDerivedBackupDay(day, section());

    expect(restored.kind).toBe('incomplete');
    if (restored.kind === 'absent') return;
    expect(restored.record.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(restored.record.beds.R4).not.toHaveProperty('vitalSignsHistory');
  });

  it('never falls back to the bed when the episode is gone from it', () => {
    const day = splitDay();
    delete day.beds.R2.clinicalEpisodeId;

    const restored = restoreClinicalDerivedBackupDay(day, section());

    expect(restored.kind).toBe('incomplete');
    if (restored.kind === 'absent') return;
    expect(restored.record.beds.R2).not.toHaveProperty('vitalSignsHistory');
  });
});
