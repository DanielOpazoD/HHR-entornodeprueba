import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  rayenToPatientData,
  reconcileCensus,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { Specialty } from '@/types/domain/patientClassification';

const REFERENCE = new Date(2026, 6, 22, 12, 0, 0);

const makeRecord = (beds: Record<string, PatientData> = {}): DailyRecord => ({
  date: '2026-07-22',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const makeEncounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'RN-NEO1',
  run: '',
  firstGivenName: 'RN de Camila',
  firstFamilyName: 'Soto',
  birthDate: '2026-07-22',
  admissionDatetime: '2026-07-22T09:00:00-06:00',
  service: 'Cunas',
  room: 'Cunas',
  bed: 'CNEO1',
  clinicalCribParentBedId: 'NEO1',
  diagnosis: 'Recién nacido en observación',
  ...overrides,
});

const snapshotOf = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-07-22T12:00:00-06:00',
  facilityId: 1342,
  encounters,
});

const seed = (encounter: RayenEncounter): PatientData =>
  rayenToPatientData(encounter, REFERENCE).patient;

describe('orphan clinical crib placement', () => {
  it('admits an unattached NEO1 crib as the principal occupant of the physical bed', () => {
    const newborn = makeEncounter();
    const current = makeRecord();
    const diff = reconcileCensus(current, snapshotOf([newborn]), { reference: REFERENCE });
    const applied = applyCensusImportDiff(current, diff, {
      idFactory: () => 'unused',
      now: REFERENCE,
      syncRunId: 'orphan-crib',
    });

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.admissions).toEqual([
      expect.objectContaining({
        bedId: 'NEO1',
        patient: expect.objectContaining({
          clinicalEpisodeId: 'RN-NEO1',
          bedMode: 'Cuna',
          specialty: Specialty.PEDIATRIA,
        }),
      }),
    ]);
    expect(diff.admissions[0].patient.clinicalCrib).toBeUndefined();
    expect(applied.record.beds.NEO1).toMatchObject({
      clinicalEpisodeId: 'RN-NEO1',
      bedMode: 'Cuna',
    });
  });

  it('keeps the newborn nested when Eloisa also reports a mother in NEO1', () => {
    const mother = makeEncounter({
      encounterId: 'MOTHER-NEO1',
      run: '144700554',
      firstGivenName: 'Camila',
      firstFamilyName: 'Soto',
      birthDate: '1990-01-01',
      administrativeSex: 'Mujer',
      service: 'Área Médico Quirúrgica Indiferenciada',
      room: 'Neo 1',
      bed: 'NEO1',
      clinicalCribParentBedId: undefined,
    });
    const diff = reconcileCensus(makeRecord(), snapshotOf([makeEncounter(), mother]), {
      reference: REFERENCE,
    });

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.admissions).toEqual([
      expect.objectContaining({
        bedId: 'NEO1',
        patient: expect.objectContaining({
          clinicalEpisodeId: 'MOTHER-NEO1',
          clinicalCrib: expect.objectContaining({ clinicalEpisodeId: 'RN-NEO1' }),
        }),
      }),
    ]);
  });

  it('does not attach or overwrite when NEO1 has a confirmed incompatible occupant', () => {
    const occupant = makeEncounter({
      encounterId: 'OTHER-NEO1',
      run: '177527531',
      firstGivenName: 'Pedro',
      firstFamilyName: 'Moreno',
      birthDate: '1980-01-01',
      administrativeSex: 'Hombre',
      service: 'Área Médico Quirúrgica Indiferenciada',
      room: 'Neo 1',
      bed: 'NEO1',
      clinicalCribParentBedId: undefined,
    });
    const current = makeRecord({ NEO1: seed(occupant) });
    const diff = reconcileCensus(current, snapshotOf([occupant, makeEncounter()]), {
      reference: REFERENCE,
    });

    expect(diff.admissions).toHaveLength(0);
    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toEqual([
      expect.objectContaining({ bedId: 'NEO1', scope: 'clinical-crib' }),
    ]);
    expect(current.beds.NEO1.clinicalCrib).toBeUndefined();
  });
});
