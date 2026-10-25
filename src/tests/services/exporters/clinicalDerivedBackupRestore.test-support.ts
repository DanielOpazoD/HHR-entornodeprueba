/**
 * Synthetic split day and backup section shared by the backup restore tests (D10 and D14 of
 * DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md): mother and newborn in R1 (the newborn with a
 * passport), a passport patient moved to R2 and a discharge of R3, each with its own episode.
 */
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import { DataFactory } from '@/tests/factories/DataFactory';

export const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_restore';
export const reading = (heartRate: number): PatientVitalSigns => ({
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
export const checkpoint = (watermark: string) => ({
  version: 3,
  fingerprintVersion: 1,
  sources: { vitals: { watermark } },
});
export const doc = (clinicalEpisodeId: string, fields: Record<string, unknown>, bedId = 'R4') => ({
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

export const patient = (bedId: string, overrides: Partial<PatientData>): PatientData => {
  const value = DataFactory.createMockPatient(bedId);
  delete value.vitalSignsHistory;
  delete value.clinicalSyncCheckpoint;
  return { ...value, ...overrides };
};

/** The split day as backed up: its split episodes keep nothing embedded. */
export const splitDay = (): DailyRecord => {
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

export const section = () => ({
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

export type Section = ReturnType<typeof section>;
export const monthBackup = (records: DailyRecord[], clinicalDerived: unknown = section()) => ({
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
export const withoutMovedFields = (record: DailyRecord): DailyRecord => ({
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
export const NEW_LAYOUT = { version: 1, generation: 'gen_synthetic_recreated' };
