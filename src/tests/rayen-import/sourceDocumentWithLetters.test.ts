import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { describe, expect, it } from 'vitest';
import { applyCensusImportDiff, reconcileCensus } from '@/features/rayen-import';
import { findManualPatientDuplicate } from '@/features/rayen-manual-import/domain/manualPatientImportPolicy';
import { associateClinicalCribsWithMothers } from '@/features/rayen-import/domain/clinicalCribMaternalAssociation';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import { isSameRut } from '@/utils/rutUtils';
import {
  encounter,
  newborn,
  snapshotOf,
  REFERENCE,
} from './clinicalCribDischargePromotion.fixtures';

// Owner decision 2026-11-12: a source document with letters (other than a final K check digit)
// is a passport and is stored as one, from new cases on. Stored patients keep their document.

const record = (beds: DailyRecord['beds'] = {}): DailyRecord => ({
  date: '2026-07-08',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const passportSource = (run: string) =>
  encounter({ encounterId: 'PASSPORT-EP', run, firstGivenName: 'Sintética' });

const sync = (current: DailyRecord, encounters: ReturnType<typeof encounter>[]) => {
  const diff = reconcileCensus(current, snapshotOf(encounters), { reference: REFERENCE });
  const saved = applyCensusImportDiff(current, diff, {
    idFactory: () => 'SYNTHETIC',
    now: REFERENCE,
    syncRunId: 'SYNTHETIC',
  }).record;
  return { diff, saved };
};

describe('a source document with letters is a passport in a new case', () => {
  it.each([
    ['1234567A', '1234567A'],
    ['12A3456785', '12A3456785'],
    ['12345678-5X', '12345678-5X'],
    [' 1234567a ', '1234567A'],
  ])('maps %j as the passport %j', (run, rut) => {
    const { patient } = rayenToPatientData(passportSource(run), REFERENCE);
    expect(patient.rut).toBe(rut);
    expect(patient.documentType).toBe('Pasaporte');
  });

  it.each([
    ['12.345.678-5', '12.345.678-5'],
    ['123456785', '12.345.678-5'],
    ['10000013k', '10.000.013-K'],
    // A mistyped check digit stays a RUT, formatted as today.
    ['123456789', '12.345.678-9'],
  ])('keeps the RUT %j as %j', (run, rut) => {
    const { patient } = rayenToPatientData(passportSource(run), REFERENCE);
    expect(patient.rut).toBe(rut);
    expect(patient.documentType).toBe('RUT');
  });

  it('admits a new episode with letters as a passport and stores it that way', () => {
    const { diff, saved } = sync(record(), [passportSource('1234567A')]);
    expect(diff.admissions).toHaveLength(1);
    expect(diff.admissions[0].patient).toMatchObject({
      rut: '1234567A',
      documentType: 'Pasaporte',
    });
    expect(saved.beds.H5C1).toMatchObject({ rut: '1234567A', documentType: 'Pasaporte' });
  });
});

describe('a stored patient keeps its document when the same episode arrives with letters', () => {
  it.each([
    ['12A3456785', '12.345.678-5'],
    ['1234567A', '123.456-7'],
  ])('incoming %j leaves the stored RUT %j untouched', (run, storedRut) => {
    const source = passportSource(run);
    const stored: PatientData = {
      ...rayenToPatientData(source, REFERENCE).patient,
      rut: storedRut,
      documentType: 'RUT',
      identityStatus: 'official',
    };
    const current = record({ [stored.bedId]: stored });
    const { diff, saved } = sync(current, [source]);
    const fields = diff.updates.flatMap(update => update.changes.map(change => change.field));
    expect(fields).not.toContain('rut');
    expect(fields).not.toContain('documentType');
    expect(diff.admissions).toEqual([]);
    expect(diff.discharges).toEqual([]);
    expect(diff.conflicts).toEqual([]);
    expect(saved.beds[stored.bedId]).toMatchObject({
      rut: storedRut,
      documentType: 'RUT',
      identityStatus: 'official',
    });
  });

  it('a stored passport of this episode stays the same passport', () => {
    const source = passportSource('1234567A');
    const stored = rayenToPatientData(source, REFERENCE).patient;
    const { diff } = sync(record({ [stored.bedId]: stored }), [source]);
    expect(diff.updates).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });
});

describe('a new passport never crosses another census patient by its digits', () => {
  const rutHolder = () =>
    encounter({
      encounterId: 'RUT-EP',
      run: '123.456-7',
      firstGivenName: 'Otra',
      firstFamilyName: 'Sintética',
      bed: 'C2',
    });

  it('is admitted as a different person from the RUT with the same digits', () => {
    const other = rutHolder();
    const stored = rayenToPatientData(other, REFERENCE).patient;
    const current = record({ [stored.bedId]: stored });
    const { diff, saved } = sync(current, [other, passportSource('1234567A')]);
    expect(diff.moves).toEqual([]);
    expect(diff.updates).toEqual([]);
    expect(diff.admissions.map(entry => entry.bedId)).toEqual(['H5C1']);
    expect(isSameRut(saved.beds.H5C1?.rut, saved.beds[stored.bedId]?.rut)).toBe(false);
    expect(saved.beds[stored.bedId]).toMatchObject({ rut: '123.456-7', documentType: 'RUT' });
  });

  it('is not reported as the manual import duplicate of that RUT', () => {
    const passport = rayenToPatientData(passportSource('1234567A'), REFERENCE).patient;
    expect(
      findManualPatientDuplicate(record({ H5C1: passport }), {
        rut: '123.456-7',
        encounterId: 'RUT-EP',
      })
    ).toBeNull();
  });

  it('is not the mother of a newborn that carries those digits as a RUN', () => {
    const mother = passportSource('1234567A');
    const child = { ...newborn(), run: '123.456-7', firstGivenName: 'RN de Otra' };
    const [, crib] = associateClinicalCribsWithMothers(
      [mother, child].map(source => ({
        encounter: source,
        mapped: rayenToPatientData(source, REFERENCE),
      })),
      () => undefined,
      () => undefined
    );
    expect(crib.maternalAssociationConflict).toBe('unmatched');
  });

  it('a readmission of the same passport is the same person by its text, never by digits', () => {
    const passport = rayenToPatientData(passportSource('1234567A'), REFERENCE).patient;
    const census = record({ H5C1: passport });
    expect(
      findManualPatientDuplicate(census, { rut: '1234567-a', encounterId: 'NEXT-EP' })
    ).toEqual({ kind: 'rut', bedId: 'H5C1' });
    expect(
      findManualPatientDuplicate(census, { rut: '1234567B', encounterId: 'NEXT-EP' })
    ).toBeNull();
  });
});
