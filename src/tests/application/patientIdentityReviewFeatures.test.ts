// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { docToRecord, sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';
import { canCarryClinicalEvidence } from '@/services/repositories/clinicalCarryoverIdentity';
import { createCensusPatientIdentityIndex } from '@/features/rayen-import/domain/censusPatientIdentityIndex';
import { harmonizeEpisodeDemographicsHistory } from '@/features/census/controllers/patientDemographicsEpisodeSyncController';
import { ensurePatientClinicalEpisodeId } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import { derivePatientRowState } from '@/features/census/controllers/patientRowStateController';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import type { RayenEncounter } from '@/features/rayen-import/contracts/rayenSnapshot';
import type { PatientData } from '@/types/domain/patient';
import { storedDay } from '@/tests/fixtures/identityReviewDayFixture';

const PRIOR = '2026-10-23';
const TODAY = '2026-10-24';

/** R1 as a read shows it: readable when its stored values are, under review otherwise. */
const readR1 = (r1Extra?: Record<string, unknown>, date = TODAY): PatientData =>
  docToRecord(storedDay(r1Extra, { date }), date).beds.R1;
const readable = (date = TODAY) => readR1({ documentType: 'Pasaporte' }, date);
const reviewed = (date = TODAY) => readR1(undefined, date);

describe('identity features never match a patient whose identity is under review', () => {
  it('never carries clinical evidence onto a RUT for a passport whose type could not be read', () => {
    const asRut = (date = TODAY) => readR1({ documentType: 'RUT' }, date);

    expect(canCarryClinicalEvidence(asRut(PRIOR), asRut(), PRIOR, TODAY)).toBe(true);
    expect(canCarryClinicalEvidence(reviewed(PRIOR), asRut(), PRIOR, TODAY)).toBe(false);
    expect(canCarryClinicalEvidence(asRut(PRIOR), reviewed(), PRIOR, TODAY)).toBe(false);
  });

  it('keeps the bed occupied for Rayen but never matches its episode or document', () => {
    const encounter = { encounterId: 'ep_synthetic_R1', run: 'FAKE-PASSPORT-R1' } as RayenEncounter;
    const census = (r1: PatientData) => ({ ...docToRecord(storedDay(), TODAY), beds: { R1: r1 } });

    const readableIndex = createCensusPatientIdentityIndex(census(readable()), [encounter]);
    const reviewedIndex = createCensusPatientIdentityIndex(census(reviewed()), [encounter]);
    const namelessIndex = createCensusPatientIdentityIndex(
      census(readR1({ documentType: 'Cedula', patientName: { text: 'X' } })),
      [encounter]
    );

    expect(readableIndex.findCurrent(encounter)?.bedId).toBe('R1');
    expect(reviewedIndex.findCurrent(encounter)).toBeUndefined();
    expect(reviewedIndex.occupiedBedIds.has('R1')).toBe(true);
    expect(namelessIndex.occupiedBedIds.has('R1')).toBe(true);
  });

  it('does not propagate demographics into, or from, a reviewed identity', async () => {
    const write = { updatePartial: vi.fn() };
    const readDay = (r1: PatientData) => ({
      getForDate: vi.fn(async () => ({ ...docToRecord(storedDay(), PRIOR), beds: { R1: r1 } })),
      getAvailableDates: vi.fn(async () => [PRIOR]),
    });
    const harmonize = (sourcePatient: PatientData, read: ReturnType<typeof readDay>) =>
      harmonizeEpisodeDemographicsHistory({
        currentDate: TODAY,
        sourcePatient: { ...sourcePatient, firstSeenDate: PRIOR },
        updatedFields: { birthDate: '1980-01-01' },
        dailyRecordReadRepository: read as never,
        dailyRecordWriteRepository: write as never,
      });

    await harmonize(readable(), readDay({ ...readable(PRIOR), firstSeenDate: PRIOR }));
    expect(write.updatePartial).toHaveBeenCalledTimes(1);

    write.updatePartial.mockClear();
    await harmonize(readable(), readDay({ ...reviewed(PRIOR), firstSeenDate: PRIOR }));
    const fromReviewed = readDay(readable(PRIOR));
    await harmonize(reviewed(), fromReviewed);

    expect(write.updatePartial).not.toHaveBeenCalled();
    expect(fromReviewed.getForDate).not.toHaveBeenCalled();
  });

  it('never derives an episode id from a reviewed identity', () => {
    const withoutEpisode = readR1({ documentType: 'Cedula', clinicalEpisodeId: undefined });

    expect(ensurePatientClinicalEpisodeId(withoutEpisode, { mode: 'admission' })).toBe(
      withoutEpisode
    );
    expect(
      ensurePatientClinicalEpisodeId(readR1({ clinicalEpisodeId: undefined }), {
        mode: 'admission',
      }).clinicalEpisodeId
    ).toMatch(/^ep_/);
  });

  it('shows a reviewed bed as occupied even when no name or document could be read', () => {
    const unnamed = readR1({ documentType: 'Cedula', patientName: { text: 'X' }, rut: ['X'] });

    expect(unnamed.patientName).toBe('');
    expect(unnamed.rut).toBe('');
    expect(derivePatientRowState(unnamed).isEmpty).toBe(false);
  });

  it('lets the stored day decide the review when a merge meets a local copy', () => {
    const day = (r1: PatientData) => ({ ...docToRecord(storedDay(), TODAY), beds: { R1: r1 } });
    const repairedElsewhere = day(readable());
    const staleLocal = day(reviewed());

    const merged = resolveDailyRecordConflict(repairedElsewhere, staleLocal);
    expect(merged.beds.R1.identityReview).toBeUndefined();
    // What a write of the merged day would send carries no review, not even an empty one.
    expect(JSON.stringify(sanitizeForFirestore(merged))).not.toContain('identityReview');
    expect(
      resolveDailyRecordConflict(staleLocal, repairedElsewhere).beds.R1.identityReview?.fields
    ).toEqual(['documentType']);
  });
});
