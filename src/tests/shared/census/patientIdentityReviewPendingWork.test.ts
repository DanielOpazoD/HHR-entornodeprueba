// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import { findDetachedReviewEdits } from '@/services/repositories/conflictResolutionDetachedEdits';
import { withStoredIdentity } from '@/shared/census/patientIdentityReview';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { IDENTITY_REVIEW_DATE as DATE, storedDay } from '@/tests/fixtures/identityReviewDayFixture';

type Json = Record<string, unknown>;

const EDITED_AT = `${DATE}T09:00:00.000Z`;
const PENDING = 'DIAGNOSTICO PENDIENTE SINTETICO';
const PATHOLOGY = ['beds.R1.pathology'];

/** A day read from storage, where R1 holds `stored` on top of a synthetic passport. */
const readDay = (stored: Json, lastUpdated?: string) =>
  docToRecord(storedDay(stored, { lastUpdated }), DATE);

/** This device's copy of R1 under review, with a diagnosis edited offline. */
const localWithPendingDiagnosis = (): DailyRecord => {
  const local = readDay({ documentType: 'Cedula' });
  local.beds.R1.pathology = PENDING;
  return local;
};

const merge = (remote: DailyRecord, local: DailyRecord) => {
  const merged = resolveDailyRecordConflict(remote, local, { changedPaths: PATHOLOGY });
  return { merged, detached: findDetachedReviewEdits(remote, local, merged, PATHOLOGY) };
};

/** The day after a write that has nothing to do with R1: an edit of R2. */
const withR2Edited = (day: DailyRecord): DailyRecord => ({
  ...day,
  beds: { ...day.beds, R2: { ...day.beds.R2, pathology: 'DIAGNOSTICO EDITADO' } },
});

describe('pending work on a bed whose identity under review changed elsewhere', () => {
  it('writes the pending diagnosis when the stored day only repaired the type', () => {
    // Another session chose the type of the very same patient and episode.
    const remote = readDay({ documentType: 'Pasaporte' }, EDITED_AT);

    const { merged, detached } = merge(remote, localWithPendingDiagnosis());

    expect(merged.beds.R1).toMatchObject({ pathology: PENDING, documentType: 'Pasaporte' });
    expect(detached).toEqual([]);
  });

  it('keeps the pending diagnosis detached when the bed now holds another episode', () => {
    const remote = readDay(
      { documentType: 'Pasaporte', clinicalEpisodeId: 'ep_synthetic_other' },
      EDITED_AT
    );

    const { merged, detached } = merge(remote, localWithPendingDiagnosis());

    expect(merged.beds.R1.pathology).not.toBe(PENDING);
    expect(detached).toEqual(PATHOLOGY);
  });

  it('keeps a repair of an unreadable field over the placeholder of a newer stored day', () => {
    const stored = { documentType: 'Pasaporte', rut: 12345678 };
    const { record: repaired } = preparePatchedRecordPersistence(readDay(stored), DATE, {
      'beds.R1.rut': 'FAKE-PASSPORT-R1B',
    } as DailyRecordPatch);
    const remote = readDay(stored, EDITED_AT);

    const merged = resolveDailyRecordConflict(remote, repaired, { changedPaths: ['beds.R1.rut'] });

    expect(withStoredIdentity(merged).beds.R1.rut).toBe('FAKE-PASSPORT-R1B');
    expect(merged.beds.R1.identityReview).toBeUndefined();
  });
});

describe('identity fields storage holds as null', () => {
  it('keeps the nulls a repair never touched after it closes the last review', () => {
    const { record } = preparePatchedRecordPersistence(
      readDay({ documentType: 'Cedula', patientName: null, admissionTime: null }),
      DATE,
      { 'beds.R1.documentType': 'Pasaporte' } as DailyRecordPatch
    );

    expect(record.beds.R1.identityReview).toBeUndefined();
    expect(withStoredIdentity(withR2Edited(record)).beds.R1).toMatchObject({
      documentType: 'Pasaporte',
      patientName: null,
      admissionTime: null,
    });
  });

  it('gives a null back with no review at all, and what the nurse wrote over one', () => {
    const day = readDay({ documentType: 'Pasaporte', patientName: null, secondLastName: null });
    const { record } = preparePatchedRecordPersistence(day, DATE, {
      'beds.R1.patientName': 'PACIENTE ESCRITO',
    } as DailyRecordPatch);

    expect(day.beds.R1.identityReview).toBeUndefined();
    expect(withStoredIdentity(day).beds.R1).toMatchObject({
      patientName: null,
      secondLastName: null,
    });
    expect(withStoredIdentity(record).beds.R1).toMatchObject({
      patientName: 'PACIENTE ESCRITO',
      secondLastName: null,
    });
    expect(JSON.stringify(withStoredIdentity(record))).not.toContain('identityNulls');
  });

  it('gives back the nulls whose values the read had to infer, until the nurse writes one', () => {
    const day = readDay({
      documentType: 'Pasaporte',
      identityStatus: null,
      firstName: null,
      lastName: null,
      secondLastName: null,
    });
    // The read shows an official status and name parts split from the full name.
    expect(day.beds.R1).toMatchObject({ identityStatus: 'official', firstName: 'PACIENTE' });
    const { record } = preparePatchedRecordPersistence(day, DATE, {
      'beds.R1.identityStatus': 'provisional',
    } as DailyRecordPatch);

    expect(withStoredIdentity(withR2Edited(day)).beds.R1).toMatchObject({
      identityStatus: null,
      firstName: null,
      lastName: null,
      secondLastName: null,
    });
    expect(withStoredIdentity(record).beds.R1).toMatchObject({
      identityStatus: 'provisional',
      firstName: null,
    });
  });
});
