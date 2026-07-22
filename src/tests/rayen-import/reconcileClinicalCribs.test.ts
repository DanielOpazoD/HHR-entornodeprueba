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

describe('reconcileClinicalCribs', () => {
  it('review-gates a nested newborn moving to an ordinary bed without duplicating it', () => {
    const mother = makeEncounter();
    const child = newborn();
    const movedChild = {
      ...child,
      room: 'Neo 1',
      bed: 'NEO1',
      clinicalCribParentBedId: undefined,
    };
    const current = makeRecord({ H5C1: { ...seed(mother), clinicalCrib: seed(child) } });
    const diff = reconcileCensus(current, snapshotOf([mother, movedChild]), {
      reference: REFERENCE,
    });
    const applied = applyCensusImportDiff(current, diff, {
      idFactory: () => 'should-not-admit',
      now: REFERENCE,
      syncRunId: 'crib-to-ordinary-bed',
    });

    expect(diff.admissions).toHaveLength(0);
    expect(diff.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ bedId: 'NEO1', scope: 'clinical-crib' })])
    );
    expect(applied.record.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
    });
    expect(applied.record.beds.NEO1?.patientName).toBeFalsy();
  });

  it('does not attach an arbitrary newborn when two snapshot cribs claim a new mother bed', () => {
    const mother = makeEncounter();
    const firstChild = newborn();
    const secondChild = {
      ...newborn(),
      encounterId: 'NEWBORN-2',
      run: '333333333',
      firstGivenName: 'Otro bebe',
    };
    const diff = reconcileCensus(makeRecord({}), snapshotOf([mother, firstChild, secondChild]), {
      reference: REFERENCE,
    });

    expect(diff.conflicts).toEqual([
      expect.objectContaining({ bedId: 'H5C1', scope: 'clinical-crib' }),
    ]);
    expect(diff.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.not.objectContaining({ clinicalCrib: expect.anything() }),
      }),
    ]);
  });

  it('does not attach a newborn when two principal encounters claim its parent bed', () => {
    const firstMother = makeEncounter();
    const secondMother = makeEncounter({
      encounterId: 'MOTHER-2',
      run: '333333333',
      firstGivenName: 'Otra madre',
    });
    const diff = reconcileCensus(
      makeRecord({}),
      snapshotOf([firstMother, secondMother, newborn()]),
      { reference: REFERENCE }
    );

    expect(diff.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bedId: 'H5C1', code: 'principal-bed-collision' }),
        expect.objectContaining({ bedId: 'H5C1', code: 'unconfirmed-principal-bed' }),
      ])
    );
    expect(diff.admissions[0].patient.clinicalCrib).toBeUndefined();
  });

  it('attaches an occupied Gestion de Camas crib to its existing principal bed', () => {
    const mother = makeEncounter();
    const diff = reconcileCensus(
      makeRecord({ H5C1: seed(mother) }),
      snapshotOf([mother, newborn()]),
      { reference: REFERENCE }
    );

    expect(diff.admissions).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.updates[0]).toMatchObject({
      bedId: 'H5C1',
      changes: [{ field: 'clinicalCrib' }],
    });
    expect(diff.updates[0].changes[0].to).toMatchObject({
      patientName: 'Bebe Perez',
      bedMode: 'Cuna',
      clinicalEpisodeId: 'NEWBORN',
      specialty: Specialty.PEDIATRIA,
    });
  });

  it('creates one principal-bed admission with its clinical crib when both are new', () => {
    const diff = reconcileCensus(makeRecord({}), snapshotOf([newborn(), makeEncounter()]), {
      reference: REFERENCE,
    });

    expect(diff.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({
          clinicalEpisodeId: 'MOTHER',
          clinicalCrib: expect.objectContaining({
            clinicalEpisodeId: 'NEWBORN',
            bedMode: 'Cuna',
            specialty: Specialty.PEDIATRIA,
            identityStatus: 'official',
          }),
        }),
      }),
    ]);
    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
  });

  it('is idempotent when the same newborn is already in the clinical crib', () => {
    const mother = makeEncounter();
    const child = newborn();
    const diff = reconcileCensus(
      makeRecord({
        H5C1: {
          ...seed(mother),
          clinicalCrib: { ...seed(child), specialty: Specialty.PEDIATRIA },
        },
      }),
      snapshotOf([mother, child]),
      { reference: REFERENCE }
    );

    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.summary.unchanged).toBe(2);
  });

  it('preserves a manually edited newborn name on subsequent synchronizations', () => {
    const mother = makeEncounter();
    const child = { ...newborn(), run: '' };
    const localChild = {
      ...seed(child),
      patientName: 'Amanda Valladares',
      specialty: Specialty.PEDIATRIA,
    };
    const diff = reconcileCensus(
      makeRecord({ H5C1: { ...seed(mother), clinicalCrib: localChild } }),
      snapshotOf([mother, child]),
      { reference: REFERENCE }
    );

    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.summary.unchanged).toBe(2);
  });

  it('updates clinical crib data without overwriting its manually edited name fields', () => {
    const mother = makeEncounter();
    const child = { ...newborn(), run: '' };
    const localChild = {
      ...seed(child),
      patientName: 'Amanda Valladares',
      firstName: 'Amanda',
      lastName: 'Valladares',
      secondLastName: '',
      pathology: 'Diagnóstico local',
      specialty: Specialty.PEDIATRIA,
    };
    const updatedChild = { ...child, diagnosis: 'Diagnóstico actualizado' };
    const diff = reconcileCensus(
      makeRecord({ H5C1: { ...seed(mother), clinicalCrib: localChild } }),
      snapshotOf([mother, updatedChild]),
      { reference: REFERENCE }
    );

    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].changes).toEqual([
      expect.objectContaining({
        field: 'clinicalCrib',
        to: expect.objectContaining({
          patientName: 'Amanda Valladares',
          firstName: 'Amanda',
          lastName: 'Valladares',
          secondLastName: '',
          pathology: 'Diagnóstico actualizado',
        }),
      }),
    ]);
  });

  it('replaces the provisional local identity when Eloísa assigns the newborn a RUN', () => {
    const mother = makeEncounter();
    const officialChild = newborn();
    const provisionalChild = {
      ...seed({ ...officialChild, run: '' }),
      patientName: 'RN de Ana',
      firstName: 'RN',
      lastName: 'De Ana',
      secondLastName: '',
      identityStatus: 'provisional' as const,
      specialty: Specialty.PEDIATRIA,
      handoffNote: 'Dato neonatal local',
    };
    const diff = reconcileCensus(
      makeRecord({ H5C1: { ...seed(mother), clinicalCrib: provisionalChild } }),
      snapshotOf([mother, officialChild]),
      { reference: REFERENCE }
    );

    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].changes).toEqual([
      expect.objectContaining({
        field: 'clinicalCrib',
        to: expect.objectContaining({
          rut: '22.222.222-2',
          patientName: 'Bebe Perez',
          firstName: 'Bebe',
          lastName: 'Perez',
          identityStatus: 'official',
          handoffNote: 'Dato neonatal local',
        }),
      }),
    ]);
  });

  it('preserves the provisional local identity when Eloísa returns an invalid RUN', () => {
    const mother = makeEncounter();
    const invalidOfficialChild = { ...newborn(), run: '12.345.678-9' };
    const provisionalChild = {
      ...seed({ ...invalidOfficialChild, run: '' }),
      patientName: 'RN de Ana',
      firstName: 'RN',
      lastName: 'De Ana',
      secondLastName: '',
      identityStatus: 'provisional' as const,
      specialty: Specialty.PEDIATRIA,
    };
    const diff = reconcileCensus(
      makeRecord({ H5C1: { ...seed(mother), clinicalCrib: provisionalChild } }),
      snapshotOf([mother, invalidOfficialChild]),
      { reference: REFERENCE }
    );

    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.summary.unchanged).toBe(2);
  });

  it('keeps an existing official RUN when a later Eloísa response is invalid', () => {
    const mother = makeEncounter();
    const officialChild = newborn();
    const incomingInvalidChild = { ...officialChild, run: '12.345.678-9' };
    const currentOfficialChild = {
      ...seed(officialChild),
      identityStatus: 'official' as const,
      specialty: Specialty.PEDIATRIA,
    };
    const diff = reconcileCensus(
      makeRecord({ H5C1: { ...seed(mother), clinicalCrib: currentOfficialChild } }),
      snapshotOf([mother, incomingInvalidChild]),
      { reference: REFERENCE }
    );

    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.summary.unchanged).toBe(2);
  });

  it('backfills Pediatría on a previously synchronized clinical crib', () => {
    const mother = makeEncounter();
    const child = newborn();
    const diff = reconcileCensus(
      makeRecord({ H5C1: { ...seed(mother), clinicalCrib: seed(child) } }),
      snapshotOf([mother, child]),
      { reference: REFERENCE }
    );

    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].changes).toEqual([
      expect.objectContaining({
        field: 'clinicalCrib',
        to: expect.objectContaining({ specialty: Specialty.PEDIATRIA }),
      }),
    ]);
  });

  it('promotes an unattached crib into the equivalent physical HHR bed', () => {
    const diff = reconcileCensus(makeRecord({}), snapshotOf([newborn()]), {
      reference: REFERENCE,
    });

    expect(diff.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({
          patientName: 'Bebe Perez',
          bedMode: 'Cuna',
          specialty: Specialty.PEDIATRIA,
        }),
      }),
    ]);
    expect(diff.admissions[0].patient.clinicalCrib).toBeUndefined();
    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
  });

  it('does not attach a newborn to an unconfirmed local occupant', () => {
    const unrelated = makeEncounter({
      encounterId: 'OTHER',
      run: '999999999',
      firstGivenName: 'Otra',
    });
    const diff = reconcileCensus(makeRecord({ H5C1: seed(unrelated) }), snapshotOf([newborn()]), {
      reference: REFERENCE,
    });

    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        scope: 'clinical-crib',
        code: 'unconfirmed-principal-bed',
        reason: expect.stringContaining('no fue confirmada'),
      }),
    ]);
  });

  it('hydrates a missing clinical episode when an existing crib matches by RUN', () => {
    const mother = makeEncounter();
    const childWithoutEpisode = { ...seed(newborn()), clinicalEpisodeId: '' };
    const diff = reconcileCensus(
      makeRecord({ H5C1: { ...seed(mother), clinicalCrib: childWithoutEpisode } }),
      snapshotOf([mother, newborn()]),
      { reference: REFERENCE }
    );

    expect(diff.updates[0].changes).toEqual([
      expect.objectContaining({
        field: 'clinicalCrib',
        to: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN' }),
      }),
    ]);
  });

  it('clears the legacy companion flag when the verified clinical crib is attached', () => {
    const mother = makeEncounter();
    const diff = reconcileCensus(
      makeRecord({ H5C1: { ...seed(mother), hasCompanionCrib: true } }),
      snapshotOf([mother, newborn()]),
      { reference: REFERENCE }
    );

    expect(diff.updates[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'clinicalCrib' }),
        expect.objectContaining({ field: 'hasCompanionCrib', to: false }),
      ])
    );
  });

  it('attaches a new crib when the principal patient moves into the parent bed', () => {
    const priorMother = makeEncounter({ room: 'H4', bed: 'C1' });
    const movedMother = makeEncounter({ room: 'H5', bed: 'C1' });
    const diff = reconcileCensus(
      makeRecord({ H4C1: seed(priorMother) }),
      snapshotOf([movedMother, newborn()]),
      { reference: REFERENCE }
    );

    expect(diff.moves).toEqual([expect.objectContaining({ fromBedId: 'H4C1', toBedId: 'H5C1' })]);
    expect(diff.updates).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        changes: [expect.objectContaining({ field: 'clinicalCrib' })],
      }),
    ]);
    expect(diff.conflicts).toHaveLength(0);
  });

  it('uses the incoming principal when the destination bed is vacated in the same sync', () => {
    const priorMother = makeEncounter({ room: 'H4', bed: 'C1' });
    const movedMother = makeEncounter({ room: 'H5', bed: 'C1' });
    const priorOccupant = makeEncounter({
      encounterId: 'OUTGOING',
      run: '999999999',
      firstGivenName: 'Paciente',
      room: 'H5',
      bed: 'C1',
    });
    const movedOccupant = { ...priorOccupant, room: 'H6', bed: 'C1' };
    const diff = reconcileCensus(
      makeRecord({
        H4C1: { ...seed(priorMother), hasCompanionCrib: true },
        H5C1: seed(priorOccupant),
      }),
      snapshotOf([movedMother, movedOccupant, newborn()]),
      { reference: REFERENCE }
    );

    expect(diff.moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromBedId: 'H4C1', toBedId: 'H5C1' }),
        expect.objectContaining({ fromBedId: 'H5C1', toBedId: 'H6C1' }),
      ])
    );
    expect(diff.updates).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'MOTHER' }),
        changes: expect.arrayContaining([
          expect.objectContaining({ field: 'clinicalCrib' }),
          expect.objectContaining({ field: 'hasCompanionCrib', to: false }),
        ]),
      }),
    ]);
    expect(diff.conflicts).toHaveLength(0);
  });
});
