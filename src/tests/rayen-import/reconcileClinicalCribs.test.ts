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

const newborn = (): RayenEncounter => makeEncounter({
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
      makeRecord({ H5C1: { ...seed(mother), clinicalCrib: seed(child) } }),
      snapshotOf([mother, child]),
      { reference: REFERENCE }
    );

    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.summary.unchanged).toBe(2);
  });

  it('does not promote an orphan attached crib into an independent HHR bed', () => {
    const diff = reconcileCensus(makeRecord({}), snapshotOf([newborn()]), {
      reference: REFERENCE,
    });

    expect(diff.admissions).toHaveLength(0);
    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toEqual([
      expect.objectContaining({ bedId: 'H5C1', patientName: 'Bebe Perez' }),
    ]);
  });

  it('does not attach a newborn to an unconfirmed local occupant', () => {
    const unrelated = makeEncounter({
      encounterId: 'OTHER',
      run: '999999999',
      firstGivenName: 'Otra',
    });
    const diff = reconcileCensus(
      makeRecord({ H5C1: seed(unrelated) }),
      snapshotOf([newborn()]),
      { reference: REFERENCE }
    );

    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
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

    expect(diff.updates[0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'clinicalCrib' }),
      expect.objectContaining({ field: 'hasCompanionCrib', to: false }),
    ]));
  });

  it('attaches a new crib when the principal patient moves into the parent bed', () => {
    const priorMother = makeEncounter({ room: 'H4', bed: 'C1' });
    const movedMother = makeEncounter({ room: 'H5', bed: 'C1' });
    const diff = reconcileCensus(
      makeRecord({ H4C1: seed(priorMother) }),
      snapshotOf([movedMother, newborn()]),
      { reference: REFERENCE }
    );

    expect(diff.moves).toEqual([
      expect.objectContaining({ fromBedId: 'H4C1', toBedId: 'H5C1' }),
    ]);
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

    expect(diff.moves).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromBedId: 'H4C1', toBedId: 'H5C1' }),
      expect.objectContaining({ fromBedId: 'H5C1', toBedId: 'H6C1' }),
    ]));
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

  it('reparents an existing crib when principal patients exchange the destination bed', () => {
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
    const child = newborn();
    const current = makeRecord({
      H4C1: seed(priorMother),
      H5C1: { ...seed(priorOccupant), clinicalCrib: seed(child) },
    });
    const diff = reconcileCensus(
      current,
      snapshotOf([movedMother, movedOccupant, child]),
      { reference: REFERENCE }
    );
    const applied = applyCensusImportDiff(current, diff, {
      idFactory: () => 'movement-id',
      now: REFERENCE,
      syncRunId: 'crib-reparent-sync',
    });

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        bedId: 'H6C1',
        changes: [expect.objectContaining({ field: 'clinicalCrib', to: undefined })],
      }),
      expect.objectContaining({
        bedId: 'H5C1',
        changes: [expect.objectContaining({ field: 'clinicalCrib' })],
      }),
    ]));
    expect(applied.skipped).toHaveLength(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'MOTHER',
      clinicalCrib: { clinicalEpisodeId: 'NEWBORN' },
    });
    expect(applied.record.beds.H6C1).toMatchObject({ clinicalEpisodeId: 'OUTGOING' });
    expect(applied.record.beds.H6C1.clinicalCrib).toBeUndefined();
  });

  it('carries an existing clinical crib when its principal patient moves', () => {
    const priorMother = makeEncounter({ room: 'H4', bed: 'C1' });
    const movedMother = makeEncounter({ room: 'H5', bed: 'C1' });
    const child = newborn();
    const diff = reconcileCensus(
      makeRecord({ H4C1: { ...seed(priorMother), clinicalCrib: seed(child) } }),
      snapshotOf([movedMother, child]),
      { reference: REFERENCE }
    );

    expect(diff.moves).toEqual([
      expect.objectContaining({ fromBedId: 'H4C1', toBedId: 'H5C1' }),
    ]);
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
