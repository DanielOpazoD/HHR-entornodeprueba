import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  reconcileCensus,
  rayenToPatientData,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { Specialty } from '@/types/domain/patientClassification';

// Saturday in Rapa Nui: the RN was born a few hours earlier, before any Registro Civil RUN.
const REFERENCE = new Date('2026-11-07T08:30:00-06:00');

const mother = (): RayenEncounter => ({
  encounterId: 'MOTHER',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1990-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H5',
  bed: 'C1',
  admissionDatetime: '2026-11-05T10:00:00-06:00',
  diagnosis: 'Puerperio',
});

const newborn = (run: string, birthDate = '2026-11-07'): RayenEncounter => ({
  ...mother(),
  encounterId: 'NEWBORN',
  run,
  firstGivenName: 'RN de Ana',
  birthDate,
  room: 'Cunas',
  bed: 'CH5C1',
  clinicalCribParentBedId: 'H5C1',
  admissionDatetime: '2026-11-07T00:03:00-06:00',
  diagnosis: 'Recién nacido',
});

const record = (beds: Record<string, PatientData>): DailyRecord => ({
  date: '2026-11-07',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const snapshotOf = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-11-07T08:30:00-06:00',
  facilityId: 1342,
  encounters,
});

const seed = (encounter: RayenEncounter): PatientData =>
  rayenToPatientData(encounter, REFERENCE).patient;

const syncedCrib = (current: DailyRecord, encounters: RayenEncounter[]): PatientData | undefined =>
  applyCensusImportDiff(
    current,
    reconcileCensus(current, snapshotOf(encounters), { reference: REFERENCE }),
    {
      idFactory: () => 'id',
      now: REFERENCE,
      syncRunId: 'newborn-run',
    }
  ).record.beds.H5C1?.clinicalCrib;

describe('newborn numbers that are not its own RUN', () => {
  it('leaves a delivery-receipt folio out of a newborn admitted at birth', () => {
    const crib = syncedCrib(record({ H5C1: seed(mother()) }), [mother(), newborn('7906953')]);

    expect(crib?.clinicalEpisodeId).toBe('NEWBORN');
    expect(crib?.rut).toBe('');
    expect(crib?.identityStatus).toBe('provisional');
  });

  it('clears a folio a previous sync stored as the newborn RUT', () => {
    const stored = {
      ...seed(newborn('7906953')),
      rut: '790.695-3',
      specialty: Specialty.PEDIATRIA,
    };
    const crib = syncedCrib(record({ H5C1: { ...seed(mother()), clinicalCrib: stored } }), [
      mother(),
      newborn('7906953'),
    ]);

    expect(crib?.rut).toBe('');
    expect(crib?.identityStatus).toBe('provisional');
  });

  it('leaves out even a number that passes the RUT check on the day of birth', () => {
    const crib = syncedCrib(record({ H5C1: seed(mother()) }), [mother(), newborn('222222222')]);

    expect(crib?.rut).toBe('');
  });

  it('keeps a RUN the nurse entered in HHR and adopts one Eloísa shows days later', () => {
    const local = {
      ...seed(newborn('7906953')),
      rut: '11.111.111-1',
      specialty: Specialty.PEDIATRIA,
    };
    expect(
      syncedCrib(record({ H5C1: { ...seed(mother()), clinicalCrib: local } }), [
        mother(),
        newborn('7906953'),
      ])?.rut
    ).toBe('11.111.111-1');

    const registered = syncedCrib(record({ H5C1: seed(mother()) }), [
      mother(),
      newborn('222222222', '2026-11-03'),
    ]);
    expect(registered?.rut).toBe('22.222.222-2');
    expect(registered?.identityStatus).toBe('official');
  });
});
