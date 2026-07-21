import { describe, expect, it } from 'vitest';
import {
  reconcileCensus,
  rayenToPatientData,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { Specialty } from '@/types/domain/patientClassification';

const REFERENCE = new Date(2026, 6, 8);

const makeRecord = (beds: Record<string, PatientData>): DailyRecord => ({
  date: '2026-07-08',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const makeEncounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'MOTHER',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H5',
  bed: 'C1',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
  diagnosis: 'Control',
  ...overrides,
});

const newborn = (): RayenEncounter =>
  makeEncounter({
    encounterId: 'NEWBORN',
    run: '222222222',
    firstGivenName: 'Bebe',
    birthDate: '2026-07-08',
    room: 'Cunas',
    bed: 'CH5C1',
    clinicalCribParentBedId: 'H5C1',
  });

const snapshotOf = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-07-08T20:00:00-06:00',
  facilityId: 1342,
  encounters,
});

const seed = (encounter: RayenEncounter): PatientData =>
  rayenToPatientData(encounter, REFERENCE).patient;

describe('reconcileClinicalCribs placement and retained principals', () => {
  it('carries an existing clinical crib when its principal patient moves', () => {
    const priorMother = makeEncounter({ room: 'H4', bed: 'C1' });
    const movedMother = makeEncounter({ room: 'H5', bed: 'C1' });
    const child = newborn();
    const diff = reconcileCensus(
      makeRecord({
        H4C1: {
          ...seed(priorMother),
          clinicalCrib: { ...seed(child), specialty: Specialty.PEDIATRIA },
        },
      }),
      snapshotOf([movedMother, child]),
      { reference: REFERENCE }
    );

    expect(diff.moves).toEqual([expect.objectContaining({ fromBedId: 'H4C1', toBedId: 'H5C1' })]);
    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.summary.unchanged).toBe(1);
  });

  it('does not attach a newborn before its admission day', () => {
    const mother = makeEncounter();
    const futureNewborn = {
      ...newborn(),
      admissionDatetime: '2026-07-09T01:00:00-06:00',
    };
    const diff = reconcileCensus(
      makeRecord({ H5C1: seed(mother) }),
      snapshotOf([mother, futureNewborn]),
      { reference: REFERENCE }
    );

    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.summary.unchanged).toBe(1);
  });

  it('accepts a clinically closed principal retained pending administrative discharge', () => {
    const mother = makeEncounter();
    const closedMother = { ...mother, hasMedicalDischarge: true };
    const diff = reconcileCensus(
      makeRecord({ H5C1: seed(mother) }),
      snapshotOf([closedMother, newborn()]),
      { reference: REFERENCE }
    );

    expect(diff.pendingAdministrativeDischarges).toHaveLength(1);
    expect(diff.updates).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        changes: expect.arrayContaining([expect.objectContaining({ field: 'clinicalCrib' })]),
      }),
    ]);
    expect(diff.conflicts).toHaveLength(0);
  });

  it('attaches a crib to a provisional clinically closed principal admission', () => {
    const closedMother = { ...makeEncounter(), hasMedicalDischarge: true };
    const diff = reconcileCensus(makeRecord({}), snapshotOf([closedMother, newborn()]), {
      reference: REFERENCE,
    });

    expect(diff.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({
          clinicalEpisodeId: 'MOTHER',
          clinicalCrib: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN' }),
        }),
      }),
    ]);
    expect(diff.conflicts).toHaveLength(0);
  });

  it('accepts a matched closed principal when Ficha omits its location', () => {
    const mother = makeEncounter();
    const closedWithoutLocation = {
      ...mother,
      room: undefined,
      bed: undefined,
      hasMedicalDischarge: true,
    };
    const diff = reconcileCensus(
      makeRecord({ H5C1: seed(mother) }),
      snapshotOf([closedWithoutLocation, newborn()]),
      { reference: REFERENCE }
    );

    expect(diff.updates).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        changes: expect.arrayContaining([expect.objectContaining({ field: 'clinicalCrib' })]),
      }),
    ]);
    expect(diff.conflicts).toHaveLength(0);
  });
});
