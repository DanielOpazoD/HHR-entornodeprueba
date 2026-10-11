import { resolveNeonatalPlacements } from '@/features/rayen-import/domain/neonatalPlacementReview';
import { describe, expect, it } from 'vitest';
import {
  reconcileCensus,
  applyCensusImportDiff,
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

const newborn = (): RayenEncounter =>
  makeEncounter({
    encounterId: 'NEWBORN',
    run: '222222222',
    firstGivenName: 'RN de Ana',
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

describe('clinical crib maternal identity precedes physical location', () => {
  const mother = () => makeEncounter({ administrativeSex: 'Mujer' });
  const misplacedChild = () => ({
    ...newborn(),
    firstGivenName: 'RN de Ana',
    firstFamilyName: 'Perez',
    bed: 'CR3',
    clinicalCribParentBedId: 'R3',
  });

  it('syncs a proven mother and matching crib without an additional review', () => {
    const parent = mother();
    const child = { ...newborn(), run: parent.run };
    const diff = reconcileCensus(makeRecord({}), snapshotOf([parent, child]), {
      reference: REFERENCE,
    });
    expect(diff.neonatalPlacementReviews).toEqual([]);
    expect(diff.conflicts).toEqual([]);
    expect(diff.admissions[0].patient.clinicalCrib?.clinicalEpisodeId).toBe(child.encounterId);
  });
  it('uses a shared maternal RUN before a conflicting RN-de name and crib bed', () => {
    const parent = mother();
    const other = makeEncounter({
      encounterId: 'OTHER',
      run: '123456785',
      firstGivenName: 'Otra',
      firstFamilyName: 'Madre',
      room: 'Recuperacion 3',
      bed: 'R3',
      administrativeSex: 'Mujer',
    });
    const child = {
      ...misplacedChild(),
      run: parent.run,
      firstGivenName: 'RN de Otra',
      firstFamilyName: 'Madre',
    };
    const diff = reconcileCensus(makeRecord({}), snapshotOf([parent, other, child]), {
      reference: REFERENCE,
    });
    expect(diff.neonatalPlacementReviews?.[0].episodeId).toBe('NEWBORN');
    const resolved = resolveNeonatalPlacements(
      makeRecord({}),
      diff,
      [{ episodeId: 'NEWBORN', kind: 'mother', bedId: 'H5C1', parentEpisodeId: 'MOTHER' }],
      '2026-07-08T20:00:00-06:00',
      'Nurse'
    );
    expect(resolved.conflicts).toHaveLength(0);
    expect(
      resolved.admissions.find(a => a.bedId === 'H5C1')?.patient.clinicalCrib?.clinicalEpisodeId
    ).toBe('NEWBORN');
    expect(resolved.admissions.find(a => a.bedId === 'H5C1')?.patient.clinicalCrib).toMatchObject({
      rut: '',
      identityStatus: 'provisional',
    });
    expect(resolved.admissions.find(a => a.bedId === 'R3')?.patient.clinicalCrib).toBeUndefined();
  });

  it('uses the complete RN-de name when the RN has its own RUN, retaining that identity', () => {
    const parent = mother();
    const child = misplacedChild();
    const current = makeRecord({ H5C1: { ...seed(parent), clinicalCrib: seed(child) } });
    const diff = reconcileCensus(current, snapshotOf([parent, child]), { reference: REFERENCE });
    const applied = applyCensusImportDiff(
      current,
      resolveNeonatalPlacements(
        current,
        diff,
        [{ episodeId: 'NEWBORN', kind: 'mother', bedId: 'H5C1', parentEpisodeId: 'MOTHER' }],
        '2026-07-08T20:00:00-06:00',
        'Nurse'
      ),
      {
        idFactory: () => 'unused',
        now: REFERENCE,
        syncRunId: 'maternal-name',
      }
    );
    expect(diff.neonatalPlacementReviews?.[0].episodeId).toBe('NEWBORN');
    expect(diff.admissions).toHaveLength(0);
    expect(applied.record.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      rut: seed(child).rut,
      bedId: 'H5C1',
    });
    expect(applied.record.beds.R3?.patientName).toBeFalsy();
  });

  it('accepts a unique first-given/first-family maternal label with omitted middle names', () => {
    const parent = { ...mother(), nextGivenNames: 'Isabel', secondFamilyName: 'Lagos' };
    const diff = reconcileCensus(makeRecord({}), snapshotOf([parent, misplacedChild()]), {
      reference: REFERENCE,
    });
    expect(diff.neonatalPlacementReviews?.[0].episodeId).toBe('NEWBORN');
    const resolved = resolveNeonatalPlacements(
      makeRecord({}),
      diff,
      [{ episodeId: 'NEWBORN', kind: 'mother', bedId: 'H5C1', parentEpisodeId: 'MOTHER' }],
      '2026-07-08T20:00:00-06:00',
      'Nurse'
    );
    expect(resolved.admissions[0].patient.clinicalCrib?.clinicalEpisodeId).toBe('NEWBORN');
  });

  it('does not decide between mothers who share the abbreviated maternal label', () => {
    const parent = { ...mother(), nextGivenNames: 'Isabel' };
    const other = {
      ...parent,
      encounterId: 'OTHER',
      run: '123456785',
      nextGivenNames: 'Maria',
      room: 'Recuperacion 3',
      bed: 'R3',
    };
    const diff = reconcileCensus(makeRecord({}), snapshotOf([parent, other, misplacedChild()]), {
      reference: REFERENCE,
    });
    expect(diff.conflicts.some(c => c.reason.includes('materna ambigua'))).toBe(true);
    expect(diff.admissions.every(a => !a.patient.clinicalCrib)).toBe(true);
  });

  it('does not choose a physical bed when two mothers have the same complete name', () => {
    const parent = mother();
    const other = {
      ...parent,
      encounterId: 'OTHER',
      run: '123456785',
      room: 'Recuperacion 3',
      bed: 'R3',
    };
    const diff = reconcileCensus(makeRecord({}), snapshotOf([parent, other, misplacedChild()]), {
      reference: REFERENCE,
    });
    expect(diff.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'clinical-crib',
          reason: expect.stringContaining('materna'),
        }),
      ])
    );
    expect(diff.admissions.every(a => !a.patient.clinicalCrib)).toBe(true);
  });

  it('does not overwrite a known RN RUN with the maternal identifier used by Eloísa', () => {
    const parent = mother();
    const localChild = seed(misplacedChild());
    localChild.bedId = 'H5C1';
    const child = { ...misplacedChild(), run: parent.run };
    const current = makeRecord({ H5C1: { ...seed(parent), clinicalCrib: localChild } });
    const diff = reconcileCensus(current, snapshotOf([parent, child]), { reference: REFERENCE });
    const applied = applyCensusImportDiff(current, diff, {
      idFactory: () => 'unused',
      now: REFERENCE,
      syncRunId: 'maternal-run',
    });
    expect(diff.neonatalPlacementReviews?.[0].episodeId).toBe('NEWBORN');
    expect(applied.record.beds.H5C1.clinicalCrib?.rut).toBe(localChild.rut);
  });

  it('does not attach an unmatched RN-de name to an unrelated woman in its physical crib location', () => {
    const child = { ...misplacedChild(), firstGivenName: 'RN de Otra' };
    const parent = { ...mother(), room: 'Recuperacion 3', bed: 'R3' };
    const diff = reconcileCensus(makeRecord({}), snapshotOf([parent, child]), {
      reference: REFERENCE,
    });
    expect(diff.conflicts.some(c => c.scope === 'clinical-crib')).toBe(true);
    expect(diff.admissions.every(a => !a.patient.clinicalCrib)).toBe(true);
  });

  it('does not infer a new RN mother from the bed when maternal identity is absent', () => {
    const parent = mother();
    const child = { ...newborn(), firstGivenName: 'Bebe' };
    const diff = reconcileCensus(makeRecord({}), snapshotOf([parent, child]), {
      reference: REFERENCE,
    });
    expect(diff.conflicts.some(c => c.reason.includes('Sin coincidencia materna'))).toBe(true);
    expect(diff.admissions.every(a => !a.patient.clinicalCrib)).toBe(true);
  });

  it('retains an exact known RN episode with a personal name despite a wrong crib location', () => {
    const parent = mother();
    const child = { ...misplacedChild(), firstGivenName: 'Nombre propio' };
    const current = makeRecord({ H5C1: { ...seed(parent), clinicalCrib: seed(child) } });
    const diff = reconcileCensus(current, snapshotOf([parent, child]), { reference: REFERENCE });
    const applied = applyCensusImportDiff(current, diff, {
      idFactory: () => 'unused',
      now: REFERENCE,
      syncRunId: 'known-mother',
    });
    expect(diff.neonatalPlacementReviews?.[0].episodeId).toBe('NEWBORN');
    expect(applied.record.beds.H5C1.clinicalCrib?.clinicalEpisodeId).toBe('NEWBORN');
    expect(applied.record.beds.R3?.patientName).toBeFalsy();
  });

  it('preserves the own RN identity when a known mother is absent and Eloísa uses her RUN', () => {
    const parent = mother();
    const localChild = seed(newborn());
    const current = makeRecord({ H5C1: { ...seed(parent), clinicalCrib: localChild } });
    const child = { ...newborn(), run: parent.run };
    const diff = reconcileCensus(current, snapshotOf([child]), { reference: REFERENCE });
    expect(diff.activeClinicalCribs?.[0].patient.rut).toBe(localChild.rut);
    expect(diff.activeClinicalCribs?.[0].patient.patientName).toBe(localChild.patientName);
  });

  it('keeps a hospitalized RN in an ordinary bed as an independent patient', () => {
    const child = {
      ...misplacedChild(),
      room: 'Neo 1',
      bed: 'NEO1',
      clinicalCribParentBedId: undefined,
    };
    const diff = reconcileCensus(makeRecord({}), snapshotOf([mother(), child]), {
      reference: REFERENCE,
    });
    expect(diff.admissions.find(a => a.bedId === 'NEO1')?.patient.clinicalEpisodeId).toBe(
      'NEWBORN'
    );
    expect(diff.admissions.find(a => a.bedId === 'H5C1')?.patient.clinicalCrib).toBeUndefined();
  });
  it('does not attach a clinically closed unidentified RN by crib bed alone', () => {
    const parent = mother();
    const child = {
      ...newborn(),
      run: '',
      firstGivenName: 'Bebe',
      firstFamilyName: '',
      hasMedicalDischarge: true,
    };
    const current = makeRecord({ H5C1: seed(parent) });
    const diff = reconcileCensus(current, snapshotOf([parent, child]), { reference: REFERENCE });
    expect(diff.conflicts.some(c => c.neonatalAssociationReview)).toBe(true);
    expect(diff.neonatalPlacementReviews?.[0].episodeId).toBe('NEWBORN');
    expect(diff.updates.every(u => !u.patient?.clinicalCrib)).toBe(true);
    expect(diff.admissions).toHaveLength(0);
  });
  it('preserves a manually classified independent RN when clinical closure still reports a crib', () => {
    const parent = mother();
    const child = { ...newborn(), hasMedicalDischarge: true };
    const current = makeRecord({
      H5C1: seed(parent),
      NEO1: { ...seed(child), bedId: 'NEO1', bedMode: 'Cama' },
    });
    const diff = reconcileCensus(current, snapshotOf([parent, child]), { reference: REFERENCE });
    expect(diff.admissions).toHaveLength(0);
    expect(diff.updates.every(u => !u.patient?.clinicalCrib)).toBe(true);
    expect(
      diff.pendingAdministrativeDischarges.some(
        d => d.bedId === 'NEO1' && d.encounterId === 'NEWBORN'
      )
    ).toBe(true);
    expect(diff.neonatalPlacementReviews?.[0].existingBedId).toBe('NEO1');
  });
});
