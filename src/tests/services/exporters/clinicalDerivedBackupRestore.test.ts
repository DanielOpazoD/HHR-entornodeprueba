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
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: mocks.getLocal,
  saveRecordsStrict: mocks.saveMany,
}));
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  saveDetailed: mocks.saveRemote,
}));
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: () => 'admin@example.invalid',
}));

import { importRecordsFromBackup } from '@/services/admin/dataMaintenanceService';
import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLocal.mockResolvedValue(null);
  mocks.saveMany.mockResolvedValue({ ok: true });
  mocks.saveRemote.mockResolvedValue(undefined);
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
