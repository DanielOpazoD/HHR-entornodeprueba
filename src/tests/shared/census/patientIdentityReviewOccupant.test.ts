// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { withStoredIdentity } from '@/shared/census/patientIdentityReview';
import { PATIENT_IDENTITY_FIELDS } from '@/types/domain/patientIdentity';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientData } from '@/types/domain/patient';
import { IDENTITY_REVIEW_DATE as DATE, storedDay } from '@/tests/fixtures/identityReviewDayFixture';

type Json = Record<string, unknown>;

/** Every identity field of a patient, as it holds it. */
const identityOf = (patient: object) =>
  Object.fromEntries(PATIENT_IDENTITY_FIELDS.map(field => [field, (patient as Json)[field]]));

/** A day read from storage, where R1 holds `stored` on top of a synthetic passport. */
const readDay = (stored: Json, lastUpdated?: string) =>
  docToRecord(storedDay(stored, { lastUpdated }), DATE);

// R1 as storage holds it: neither its document type nor its episode can be read.
const UNREADABLE_R1 = { documentType: 'Cedula', clinicalEpisodeId: { fake: 'FAKE-EP-OLD' } };

/** Another patient, admitted to R1, as the nurse entered it. */
const NEW_PATIENT = {
  patientName: 'PACIENTE NUEVO SINTETICO',
  firstName: 'PACIENTE',
  lastName: 'NUEVO',
  secondLastName: 'SINTETICO',
  rut: 'FAKE-PASSPORT-NEW',
  documentType: 'Pasaporte',
  identityStatus: 'official',
  admissionDate: DATE,
  admissionTime: '11:30',
  clinicalEpisodeId: undefined,
  pathology: 'DIAGNOSTICO SINTETICO NUEVO',
} as const;

const withR1 = (day: DailyRecord, r1: PatientData): DailyRecord => ({
  ...day,
  beds: { ...day.beds, R1: r1 },
});

/** The day after a write that has nothing to do with R1: an edit of R2. */
const withR2Edited = (day: DailyRecord): DailyRecord => ({
  ...day,
  beds: { ...day.beds, R2: { ...day.beds.R2, pathology: 'DIAGNOSTICO EDITADO' } },
});

describe('a review gives storage back what it held only for the patient it was read for', () => {
  it('stores a patient admitted after a discharge as entered, even with the old review left on', () => {
    const day = readDay(UNREADABLE_R1);
    // The bed object outlived its occupant: a discharge and an admission rewrote what it holds.
    const admitted = withR1(day, { ...day.beds.R1, ...NEW_PATIENT });

    const stored = withStoredIdentity(admitted).beds.R1;

    expect(identityOf(stored)).toEqual(identityOf({ ...day.beds.R1, ...NEW_PATIENT }));
    expect(stored.identityReview).toBeUndefined();
  });

  it('keeps no review, here or in storage, after a patch replaces the whole bed', () => {
    const day = readDay(UNREADABLE_R1);
    const replacement = { ...day.beds.R1, ...NEW_PATIENT };

    const { record, mergedPatches } = preparePatchedRecordPersistence(day, DATE, {
      'beds.R1': replacement,
    } as DailyRecordPatch);

    expect(record.beds.R1.identityReview).toBeUndefined();
    const sent = withStoredIdentity(mergedPatches) as Record<string, PatientData>;
    expect(identityOf(sent['beds.R1'])).toEqual(identityOf(replacement));
    expect(withStoredIdentity(record).beds.R1).toMatchObject({
      documentType: 'Pasaporte',
      rut: 'FAKE-PASSPORT-NEW',
    });
  });

  it('keeps a repair when it reaches a write without a patch of that field', () => {
    const day = readDay({ documentType: 'Cedula', patientName: { full: 'FAKE-NAME' } });
    // The repaired type is in the bed, but its review still lists it.
    const repaired = withR1(day, { ...day.beds.R1, documentType: 'Pasaporte' });

    expect(withStoredIdentity(repaired).beds.R1).toMatchObject({
      documentType: 'Pasaporte',
      patientName: { full: 'FAKE-NAME' },
    });
  });

  it('keeps a repair merged onto a newer stored day, and later unrelated writes keep it', () => {
    const stored = { documentType: 'Cedula', patientName: { full: 'FAKE-NAME' } };
    const remote = readDay(stored, `${DATE}T09:00:00.000Z`);
    const { record: local } = preparePatchedRecordPersistence(readDay(stored), DATE, {
      'beds.R1.documentType': 'Pasaporte',
    } as DailyRecordPatch);

    const merged = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['beds.R1.documentType'],
    });
    for (const day of [merged, withR2Edited(merged)]) {
      expect(withStoredIdentity(day).beds.R1).toMatchObject({
        documentType: 'Pasaporte',
        patientName: { full: 'FAKE-NAME' },
      });
    }
  });

  it('gives back every field still unreadable, exactly, on an unrelated write', () => {
    const stored = {
      documentType: 'Cedula',
      patientName: null,
      rut: ['FAKE-RUT', null],
      clinicalEpisodeId: 4321,
    };
    const { record } = preparePatchedRecordPersistence(readDay(stored), DATE, {
      'beds.R1.documentType': 'Pasaporte',
    } as DailyRecordPatch);
    const r1 = withStoredIdentity(withR2Edited(record)).beds.R1 as unknown as Json;

    expect(r1).toMatchObject({ documentType: 'Pasaporte', clinicalEpisodeId: 4321 });
    expect(r1.patientName).toBeNull();
    expect(r1.rut).toEqual(['FAKE-RUT', null]);
  });

  it('never gives the review of the mother to the newborn crib, or the reverse', () => {
    const day = readDay(UNREADABLE_R1);
    const mother = day.beds.R1;
    // A newborn whose own identity is what it shows, carrying the review of its mother.
    const newborn = { ...mother, bedMode: 'Cuna', identityReview: mother.identityReview };
    const { identityReview: _mother, ...motherAlone } = mother;

    const stored = withStoredIdentity(
      withR1(day, { ...motherAlone, clinicalCrib: newborn } as PatientData)
    ).beds.R1;

    expect(stored.clinicalCrib?.documentType).toBeUndefined();
    expect(stored.clinicalCrib?.clinicalEpisodeId).toBeUndefined();
    expect(stored.clinicalCrib?.identityReview).toBeUndefined();
  });

  it('keeps a local clear of a bed under review when it merges onto the stored day', () => {
    const remote = readDay(UNREADABLE_R1, `${DATE}T09:00:00.000Z`);
    const cleared = withR1(readDay(UNREADABLE_R1), createEmptyPatient('R1'));

    const merged = resolveDailyRecordConflict(remote, cleared, { changedPaths: ['beds.R1'] });

    expect(merged.beds.R1.patientName).toBe('');
    expect(merged.beds.R1.identityReview).toBeUndefined();
  });
});
