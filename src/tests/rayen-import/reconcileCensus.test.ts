import { describe, expect, it } from 'vitest';
import {
  reconcileCensus,
  requiresReview,
  rayenToPatientData,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const REFERENCE = new Date(2026, 6, 8);

const makeRecord = (
  beds: Record<string, PatientData>,
  extras: Partial<Pick<DailyRecord, 'discharges' | 'cma' | 'transfers'>> = {}
): DailyRecord => ({
  date: '2026-07-08',
  beds,
  discharges: extras.discharges ?? [],
  transfers: extras.transfers ?? [],
  cma: extras.cma ?? [],
  lastUpdated: '',
  activeExtraBeds: [],
});

/** Minimal HHR discharge record (only the fields reconcile reads for identity). */
const hhrDischarge = (rut: string, episodeId: string): DailyRecord['discharges'][number] =>
  ({ rut, clinicalEpisodeId: episodeId }) as unknown as DailyRecord['discharges'][number];

const makeEncounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'E1',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H1',
  bed: 'C2',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
  diagnosis: 'Neumonía',
  ...overrides,
});

const snapshotOf = (encounters: RayenEncounter[], isComplete = false): RayenCensusSnapshot => ({
  capturedAt: '2026-07-08T20:00:00-06:00',
  facilityId: 1342,
  encounters,
  isComplete,
});

/** Seed a current bed from the same mapping the reconciler uses (so it starts "unchanged"). */
const seedBed = (encounter: RayenEncounter, bedIdOverride?: string): [string, PatientData] => {
  const { patient, bedId } = rayenToPatientData(encounter, REFERENCE);
  const key = bedIdOverride ?? bedId ?? '';
  return [key, patient];
};

describe('reconcileCensus', () => {
  it('admits a CMA-service patient as a NORMAL admission into the real bed (CMA is a discharge type)', () => {
    const diff = reconcileCensus(
      makeRecord({}),
      snapshotOf([
        makeEncounter({ service: 'Área quirúrgica indiferenciada', room: 'CMA R1', bed: 'CMAR1' }),
      ]),
      { reference: REFERENCE }
    );
    expect(diff.admissions).toHaveLength(1);
    expect(diff.admissions[0].isCma).toBe(false); // never flagged CMA at admission
    expect(diff.admissions[0].bedId).toBe('R1'); // the real bed, not a virtual CMA slot
  });

  it('keeps a CMA patient in bed when absent from Ficha Médico until administrative confirmation', () => {
    const cma = makeEncounter({
      service: 'Área quirúrgica indiferenciada',
      room: 'CMA R1',
      bed: 'CMAR1',
    });
    const [bedId, patient] = seedBed(cma); // patient.location = "…/CMA R1/CMAR1"
    const diff = reconcileCensus(makeRecord({ [bedId]: patient }), snapshotOf([], true), {
      reference: REFERENCE,
    });
    expect(diff.discharges).toHaveLength(0);
    expect(diff.pendingAdministrativeDischarges).toEqual([
      expect.objectContaining({ bedId: 'R1', signal: 'missing-from-ficha' }),
    ]);
  });

  it('does not infer a plain alta when a non-CMA patient vanishes from a complete census', () => {
    const [bedId, patient] = seedBed(makeEncounter()); // médico-quirúrgica bed, no CMA
    const diff = reconcileCensus(makeRecord({ [bedId]: patient }), snapshotOf([], true), {
      reference: REFERENCE,
    });
    expect(diff.discharges).toHaveLength(0);
    expect(diff.pendingAdministrativeDischarges[0]).toMatchObject({
      bedId,
      signal: 'missing-from-ficha',
    });
  });

  it('creates an admission for a Rayen patient absent from the census', () => {
    const diff = reconcileCensus(makeRecord({}), snapshotOf([makeEncounter()]), {
      reference: REFERENCE,
    });
    expect(diff.summary).toMatchObject({ admissions: 1, updates: 0, moves: 0, discharges: 0 });
    expect(diff.admissions[0].bedId).toBe('H1C2');
    expect(diff.admissions[0].patient.patientName).toBe('Ana Perez');
  });

  it('does not admit a patient admitted AFTER the census day being synced', () => {
    // Syncing the 07-08 census; this patient entered 07-09 → belongs only from 07-09 onward.
    const diff = reconcileCensus(
      makeRecord({}),
      snapshotOf([makeEncounter({ admissionDatetime: '2026-07-09T09:00:00-06:00' })]),
      { reference: REFERENCE }
    );
    expect(diff.admissions).toHaveLength(0);
  });

  it('still admits a patient admitted ON the census day', () => {
    const diff = reconcileCensus(
      makeRecord({}),
      snapshotOf([makeEncounter({ admissionDatetime: '2026-07-08T23:30:00-06:00' })]),
      { reference: REFERENCE }
    );
    expect(diff.admissions).toHaveLength(1);
  });

  it('reports no change when the census already matches Rayen', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const diff = reconcileCensus(makeRecord({ [bedId]: patient }), snapshotOf([makeEncounter()]), {
      reference: REFERENCE,
    });
    expect(diff.summary.unchanged).toBe(1);
    expect(diff.updates).toHaveLength(0);
  });

  it('hydrates authoritative episode identity for an otherwise unchanged legacy patient', () => {
    const encounter = makeEncounter({ encounterId: 'CURRENT-EPISODE' });
    const [bedId, patient] = seedBed(encounter);
    const diff = reconcileCensus(
      makeRecord({ [bedId]: { ...patient, clinicalEpisodeId: undefined } }),
      snapshotOf([encounter]),
      { reference: REFERENCE }
    );

    expect(diff.unchangedCount).toBe(0);
    expect(diff.updates).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ encounterId: 'CURRENT-EPISODE' }),
        changes: expect.arrayContaining([
          expect.objectContaining({ field: 'clinicalEpisodeId', to: 'CURRENT-EPISODE' }),
        ]),
      }),
    ]);
  });

  it('detects an update when a Rayen-sourced field changed', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const stale = { ...patient, pathology: 'Diagnóstico viejo' };
    const diff = reconcileCensus(
      makeRecord({ [bedId]: stale }),
      snapshotOf([makeEncounter({ diagnosis: 'Neumonía' })]),
      { reference: REFERENCE }
    );
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].changes.map(c => c.field)).toContain('pathology');
  });

  it('cleans a previously persisted missing-surname placeholder on the next sync', () => {
    const encounter = makeEncounter({ secondFamilyName: 'Noinformado' });
    const [bedId, patient] = seedBed(encounter);
    const stale = {
      ...patient,
      patientName: 'Ana Perez Noinformado',
      secondLastName: 'Noinformado',
    };

    const diff = reconcileCensus(makeRecord({ [bedId]: stale }), snapshotOf([encounter]), {
      reference: REFERENCE,
    });

    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'patientName', to: 'Ana Perez' }),
        expect.objectContaining({ field: 'secondLastName', to: '' }),
      ])
    );
  });

  it('updates principal diagnosis and CIE-10 together without erasing local coding on lookup failure', () => {
    const coded = makeEncounter({
      diagnosis: 'Neumonía bacteriana',
      diagnosisCode: 'J15.9',
      diagnosisDescription: 'Neumonía bacteriana, no especificada',
    });
    const [bedId, patient] = seedBed(makeEncounter());
    const local = { ...patient, cie10Code: 'A00.0', cie10Description: 'Código local anterior' };

    const codedDiff = reconcileCensus(makeRecord({ [bedId]: local }), snapshotOf([coded]), {
      reference: REFERENCE,
    });
    expect(codedDiff.updates[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'pathology', to: 'Neumonía bacteriana' }),
        expect.objectContaining({ field: 'cie10Code', to: 'J15.9' }),
        expect.objectContaining({
          field: 'cie10Description',
          to: 'Neumonía bacteriana, no especificada',
        }),
      ])
    );

    const unavailableDiff = reconcileCensus(
      makeRecord({ [bedId]: local }),
      snapshotOf([makeEncounter()]),
      { reference: REFERENCE }
    );
    expect(
      unavailableDiff.updates.flatMap(update => update.changes.map(change => change.field))
    ).not.toEqual(expect.arrayContaining(['cie10Code', 'cie10Description']));
  });

  it('detects a move when the Rayen bed differs from the census bed', () => {
    // Same episode currently in H2C1, Rayen now places it in H1C2.
    const [, patient] = seedBed(makeEncounter());
    const diff = reconcileCensus(
      makeRecord({ H2C1: { ...patient, bedId: 'H2C1' } }),
      snapshotOf([makeEncounter({ room: 'H1', bed: 'C2' })]),
      { reference: REFERENCE }
    );
    expect(diff.moves).toHaveLength(1);
    expect(diff.moves[0]).toMatchObject({ fromBedId: 'H2C1', toBedId: 'H1C2' });
  });

  it('keeps a medically-discharged patient in bed pending administrative discharge', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const diff = reconcileCensus(
      makeRecord({ [bedId]: patient }),
      snapshotOf([makeEncounter({ hasMedicalDischarge: true })]),
      { reference: REFERENCE }
    );
    expect(diff.discharges).toHaveLength(0);
    expect(diff.pendingAdministrativeDischarges).toHaveLength(1);
    expect(diff.pendingAdministrativeDischarges[0]).toMatchObject({
      bedId,
      signal: 'clinical-closure',
    });
  });

  it('keeps a medically-discharged CMA patient pending without guessing its final type', () => {
    const cmaEncounter = makeEncounter({
      encounterId: 'ECMA',
      service: 'Área quirúrgica indiferenciada',
      room: 'CMA R1',
      bed: 'CMAR1',
    });
    const [bedId, patient] = seedBed(cmaEncounter); // bedId === 'R1'
    const diff = reconcileCensus(
      makeRecord({ [bedId]: patient }),
      snapshotOf([{ ...cmaEncounter, hasMedicalDischarge: true }]),
      { reference: REFERENCE }
    );
    expect(diff.discharges).toHaveLength(0);
    expect(diff.pendingAdministrativeDischarges).toHaveLength(1);
    expect(diff.pendingAdministrativeDischarges[0]).toMatchObject({
      signal: 'clinical-closure',
      bedId: 'R1',
    });
  });

  it('restores a medically-discharged patient that was deleted from the HHR bed', () => {
    // Patient has alta médica in Rayen but its HHR bed is empty and it is NOT in HHR's
    // discharge records → it was deleted, not nurse-discharged → offer to re-admit.
    const enc = makeEncounter({ room: 'Recuperacion 2', bed: 'R2', hasMedicalDischarge: true });
    const diff = reconcileCensus(makeRecord({}), snapshotOf([enc], true), {
      reference: REFERENCE,
    });
    expect(diff.admissions).toHaveLength(1);
    expect(diff.admissions[0].bedId).toBe('R2');
    expect(diff.discharges).toHaveLength(0);
    expect(diff.pendingAdministrativeDischarges).toHaveLength(0);
  });

  it('does not restore a patient already represented by an HHR movement', () => {
    // The patient's statistical movement is already stored, so their absence from the bed is
    // intentional even if Ficha Médico still returns the clinical encounter.
    const enc = makeEncounter({ room: 'Recuperacion 2', bed: 'R2', hasMedicalDischarge: true });
    const diff = reconcileCensus(
      makeRecord({}, { discharges: [hhrDischarge(enc.run, enc.encounterId)] }),
      snapshotOf([enc], true),
      { reference: REFERENCE }
    );
    expect(diff.admissions).toHaveLength(0);
    expect(diff.pendingAdministrativeDischarges).toHaveLength(0);
    expect(diff.discharges).toHaveLength(0);
  });

  it('restores a readmitted patient when only an older episode has an HHR movement', () => {
    const encounter = makeEncounter({
      encounterId: 'READMISSION',
      run: '14.470.055-4',
      room: 'Recuperacion 2',
      bed: 'R2',
    });
    const diff = reconcileCensus(
      makeRecord({}, { discharges: [hhrDischarge(encounter.run, 'OLD-EPISODE')] }),
      snapshotOf([encounter], true),
      { reference: REFERENCE }
    );

    expect(diff.admissions).toEqual([
      expect.objectContaining({
        bedId: 'R2',
        patient: expect.objectContaining({ clinicalEpisodeId: 'READMISSION' }),
      }),
    ]);
  });

  it('does not record an egreso even when both clinical closures are complete', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const diff = reconcileCensus(
      makeRecord({ [bedId]: patient }),
      snapshotOf([makeEncounter({ hasMedicalDischarge: true, hasNurseDischarge: true })]),
      { reference: REFERENCE }
    );
    expect(diff.pendingAdministrativeDischarges).toHaveLength(1);
    expect(diff.pendingAdministrativeDischarges[0]).toMatchObject({
      bedId,
      signal: 'clinical-closure',
    });
    expect(diff.discharges).toHaveLength(0);
    expect(requiresReview(diff)).toBe(true);
  });

  it('restores a deceased clinical encounter when no administrative egreso exists yet', () => {
    const enc = makeEncounter({ room: 'Recuperacion 2', bed: 'R2', isDead: true });
    const diff = reconcileCensus(makeRecord({}), snapshotOf([enc], true), { reference: REFERENCE });
    expect(diff.admissions).toHaveLength(1);
    expect(diff.discharges).toHaveLength(0);
    expect(diff.pendingAdministrativeDischarges).toHaveLength(0);
  });

  it('restores an absent patient with nursing closure until the administrative report confirms it', () => {
    const enc = makeEncounter({
      room: 'Recuperacion 2',
      bed: 'R2',
      hasMedicalDischarge: true,
      hasNurseDischarge: true,
    });
    const diff = reconcileCensus(makeRecord({}), snapshotOf([enc], true), { reference: REFERENCE });
    expect(diff.admissions).toHaveLength(1);
    expect(diff.discharges).toHaveLength(0);
    expect(diff.pendingAdministrativeDischarges).toHaveLength(0);
  });

  it('flags a census patient absent from a COMPLETE snapshot as pending administrative discharge', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const diff = reconcileCensus(makeRecord({ [bedId]: patient }), snapshotOf([], true), {
      reference: REFERENCE,
    });
    expect(diff.discharges).toHaveLength(0);
    expect(diff.pendingAdministrativeDischarges[0]).toMatchObject({
      bedId,
      signal: 'missing-from-ficha',
    });
  });

  it('NEVER infers a discharge from a partial snapshot (isComplete omitted/false)', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const diff = reconcileCensus(makeRecord({ [bedId]: patient }), snapshotOf([]), {
      reference: REFERENCE,
    });
    expect(diff.discharges).toHaveLength(0);
    expect(diff.pendingAdministrativeDischarges).toHaveLength(0);
  });

  it('reports a conflict when a new Rayen patient targets an occupied bed', () => {
    const occupant: PatientData = {
      ...EMPTY_PATIENT,
      bedId: 'H1C2',
      patientName: 'Otro Paciente',
      rut: '9.999.999-9',
      clinicalEpisodeId: 'OTHER',
    };
    const incoming = makeEncounter({ encounterId: 'NEW', run: '111111111' });
    const diff = reconcileCensus(makeRecord({ H1C2: occupant }), snapshotOf([incoming]), {
      reference: REFERENCE,
    });
    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0].bedId).toBe('H1C2');
    expect(diff.admissions).toHaveLength(0);
  });

  it('reserves a confirmed principal bed against a second snapshot claimant', () => {
    const principal = makeEncounter();
    const [bedId, patient] = seedBed(principal);
    const duplicate = makeEncounter({
      encounterId: 'DUPLICATE',
      run: '111111111',
      firstGivenName: 'Otra',
    });
    const diff = reconcileCensus(
      makeRecord({ [bedId]: patient }),
      snapshotOf([principal, duplicate]),
      { reference: REFERENCE }
    );

    expect(diff.admissions).toHaveLength(0);
    expect(diff.conflicts).toEqual([
      expect.objectContaining({ bedId, code: 'principal-bed-collision' }),
    ]);
  });

  it('reports a conflict when the Rayen bed cannot be mapped', () => {
    const diff = reconcileCensus(
      makeRecord({}),
      snapshotOf([makeEncounter({ room: 'ZZ', bed: 'QQ' })]),
      { reference: REFERENCE }
    );
    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0].bedId).toBeNull();
  });

});

describe('requiresReview (auto-mode safety gate)', () => {
  it('is false for a clean diff (only admissions)', () => {
    const diff = reconcileCensus(makeRecord({}), snapshotOf([makeEncounter()]), {
      reference: REFERENCE,
    });
    expect(requiresReview(diff)).toBe(false);
  });

  it('is true when there are conflicts', () => {
    const occupant: PatientData = {
      ...EMPTY_PATIENT,
      bedId: 'H1C2',
      patientName: 'Otro',
      rut: '9.999.999-9',
      clinicalEpisodeId: 'OTHER',
    };
    const diff = reconcileCensus(
      makeRecord({ H1C2: occupant }),
      snapshotOf([makeEncounter({ encounterId: 'NEW', run: '111111111' })]),
      { reference: REFERENCE }
    );
    expect(requiresReview(diff)).toBe(true);
  });

  it('is true when an administrative discharge is pending', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const diff = reconcileCensus(makeRecord({ [bedId]: patient }), snapshotOf([], true), {
      reference: REFERENCE,
    });
    expect(requiresReview(diff)).toBe(true);
  });

  it('is true for a clinical closure kept in bed pending administrative confirmation', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const diff = reconcileCensus(
      makeRecord({ [bedId]: patient }),
      snapshotOf([makeEncounter({ hasMedicalDischarge: true })], true),
      { reference: REFERENCE }
    );
    expect(diff.pendingAdministrativeDischarges).toHaveLength(1);
    expect(requiresReview(diff)).toBe(true);
  });
});
