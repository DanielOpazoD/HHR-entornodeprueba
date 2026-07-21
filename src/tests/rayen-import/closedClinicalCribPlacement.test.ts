import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  reconcileCensus,
  rayenToPatientData,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { Specialty } from '@/types/domain/patientClassification';

const REFERENCE = new Date(2026, 6, 8);

const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
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
  encounter({
    encounterId: 'NEWBORN',
    run: '222222222',
    firstGivenName: 'Bebe',
    birthDate: '2026-07-08',
    room: 'Cunas',
    bed: 'CH5C1',
    clinicalCribParentBedId: 'H5C1',
    hasMedicalDischarge: true,
  });

const seed = (source: RayenEncounter) => rayenToPatientData(source, REFERENCE).patient;
const clinicalCribSeed = (source: RayenEncounter) => ({
  ...seed(source),
  specialty: Specialty.PEDIATRIA,
});

const snapshotOf = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-07-08T20:00:00-06:00',
  facilityId: 1342,
  encounters,
});

const emptyRecord = (): DailyRecord => ({
  date: '2026-07-08',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const apply = (current: DailyRecord, encounters: RayenEncounter[]) => {
  const diff = reconcileCensus(current, snapshotOf(encounters), { reference: REFERENCE });
  const applied = applyCensusImportDiff(current, diff, {
    idFactory: () => 'movement-id',
    now: REFERENCE,
    syncRunId: 'closed-crib-placement',
  });
  return { diff, applied };
};

describe('closed clinical crib placement', () => {
  it('keeps a pending unchanged crib without emitting an empty update', () => {
    const mother = encounter();
    const child = newborn();
    const current: DailyRecord = {
      ...emptyRecord(),
      beds: { H5C1: { ...seed(mother), clinicalCrib: clinicalCribSeed(child) } },
    };

    const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });

    expect(diff.pendingAdministrativeDischarges).toEqual([
      expect.objectContaining({ encounterId: 'NEWBORN', bedId: 'H5C1' }),
    ]);
    expect(diff.updates).toHaveLength(0);
    expect(diff.summary.updates).toBe(0);
  });

  it('attaches a clinically closed newborn to a mother admitted into an empty bed', () => {
    const mother = encounter();
    const child = newborn();
    const { diff, applied } = apply(emptyRecord(), [mother, child]);

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({
          clinicalEpisodeId: 'MOTHER',
          clinicalCrib: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN' }),
        }),
      }),
    ]);
    expect(diff.pendingAdministrativeDischarges).toEqual([
      expect.objectContaining({ encounterId: 'NEWBORN', bedId: 'H5C1' }),
    ]);
    expect(applied.record.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
    });
  });

  it('moves a clinically closed newborn with its mother into an empty destination bed', () => {
    const priorMother = encounter({ room: 'H4' });
    const movedMother = encounter();
    const child = newborn();
    const current: DailyRecord = {
      ...emptyRecord(),
      beds: {
        H4C1: {
          ...seed(priorMother),
          clinicalCrib: clinicalCribSeed({ ...child, room: 'Cunas', bed: 'CH4C1' }),
        },
      },
    };
    const { diff, applied } = apply(current, [movedMother, child]);

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.moves).toEqual([expect.objectContaining({ fromBedId: 'H4C1', toBedId: 'H5C1' })]);
    expect(applied.record.beds.H4C1).toBeUndefined();
    expect(applied.record.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
    });
  });

  it('infers the destination for a location-less closed newborn when its mother moves', () => {
    const priorMother = encounter({ room: 'H4' });
    const movedMother = encounter();
    const locatedChild = newborn();
    const locationlessChild = {
      ...locatedChild,
      room: undefined,
      bed: undefined,
      clinicalCribParentBedId: undefined,
    };
    const current: DailyRecord = {
      ...emptyRecord(),
      beds: { H4C1: { ...seed(priorMother), clinicalCrib: clinicalCribSeed(locatedChild) } },
    };
    const { diff, applied } = apply(current, [movedMother, locationlessChild]);

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.pendingAdministrativeDischarges).toEqual([
      expect.objectContaining({ encounterId: 'NEWBORN', bedId: 'H5C1' }),
    ]);
    expect(applied.record.beds.H4C1).toBeUndefined();
    expect(applied.record.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
    });
  });
});
