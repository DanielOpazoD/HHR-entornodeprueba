// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { docToRecord, sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';
import { canCarryClinicalEvidence } from '@/services/repositories/clinicalCarryoverIdentity';
import { createCensusPatientIdentityIndex } from '@/features/rayen-import/domain/censusPatientIdentityIndex';
import { harmonizeEpisodeDemographicsHistory } from '@/features/census/controllers/patientDemographicsEpisodeSyncController';
import { ensurePatientClinicalEpisodeId } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import { derivePatientRowState } from '@/features/census/controllers/patientRowStateController';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import { resolvePatientRowCapabilities } from '@/features/census/controllers/patientRowCapabilitiesController';
import { resolveClinicalDocumentsWorkspaceAccessState } from '@/features/clinical-documents/hooks/clinicalDocumentsWorkspaceModelSupport';
import {
  buildClinicalBedsFromPreviousRecord,
  buildEmptyClinicalBeds,
  preserveCIE10FromPreviousDay,
} from '@/services/repositories/dailyRecordClinicalDomainService';
import { syncPatientsToMasterInBackground } from '@/services/repositories/dailyRecordBackgroundMasterSyncController';
import { PatientMasterRepository } from '@/services/repositories/PatientMasterRepository';
import type { RayenEncounter } from '@/features/rayen-import/contracts/rayenSnapshot';
import type { PatientData } from '@/types/domain/patient';
import { withStoredIdentity } from '@/shared/census/patientIdentityReview';
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

  it('never moves the clinical text of another copy onto an identity under review', () => {
    // Stored: a passport whose number and episode cannot be read. The local copy has the same name
    // and admission date, no document or episode, and another patient's diagnosis and note.
    const remote = docToRecord(
      storedDay({
        rut: { fake: 'REMOTE-DOC' },
        clinicalEpisodeId: { fake: 'REMOTE-EP' },
        pathology: '',
        medicalHandoffNote: '',
      }),
      TODAY
    );
    const local = docToRecord(
      storedDay({
        rut: '',
        clinicalEpisodeId: undefined,
        pathology: 'OTRO DIAGNOSTICO SINTETICO',
        medicalHandoffNote: 'OTRA NOTA SINTETICA',
      }),
      TODAY
    );

    [
      resolveDailyRecordConflict(remote, local),
      resolveDailyRecordConflict(remote, local, { changedPaths: ['beds.R1'] }),
      resolveDailyRecordConflict(remote, local, {
        changedPaths: ['beds.R1.pathology', 'beds.R1.medicalHandoffNote'],
      }),
    ].forEach(merged => {
      expect(merged.beds.R1).toMatchObject({ pathology: '', medicalHandoffNote: '' });
      expect(withStoredIdentity(merged).beds.R1).toMatchObject({
        rut: { fake: 'REMOTE-DOC' },
        clinicalEpisodeId: { fake: 'REMOTE-EP' },
      });
    });
  });

  it('merges a clinical edit of the very same identity under review', () => {
    const remote = docToRecord(
      storedDay(undefined, { lastUpdated: `${TODAY}T09:00:00.000Z` }),
      TODAY
    );
    const local = docToRecord(storedDay(), TODAY);
    local.beds.R1.pathology = 'DIAGNOSTICO EDITADO';

    const merged = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['beds.R1.pathology'],
    });

    expect(merged.beds.R1.pathology).toBe('DIAGNOSTICO EDITADO');
    expect(merged.beds.R1.identityReview?.fields).toEqual(['documentType']);
  });

  it('never opens documents, requests or history found by a RUT under review', () => {
    // The stored RUT is a number: a read shows none, and the RUT stays under review.
    const asNumber = readR1({ documentType: 'RUT', rut: 12345678, clinicalEpisodeId: undefined });
    const row = (patient: PatientData) =>
      resolvePatientRowCapabilities({
        role: 'nurse_hospital',
        patient,
        isBlocked: false,
        isEmpty: false,
      });

    expect(row(readable())).toMatchObject({ canOpenClinicalDocuments: true, canOpenHistory: true });
    expect(row(asNumber)).toEqual({
      canOpenClinicalDocuments: false,
      canOpenExamRequest: false,
      canOpenImagingRequest: false,
      canOpenHistory: false,
      canShowClinicalDocumentIndicator: false,
    });
    expect(resolveClinicalDocumentsWorkspaceAccessState(readable(), 'nurse_hospital').canRead).toBe(
      true
    );
    expect(resolveClinicalDocumentsWorkspaceAccessState(asNumber, 'nurse_hospital')).toMatchObject({
      canRead: false,
      canEdit: false,
      readOnlyMessage: 'Identidad de la cama R1 por revisar: RUT o pasaporte.',
    });
  });

  it('never gives another patient in the bed the CIE-10 of a name under review', () => {
    const beds = (r1: PatientData) => ({ ...docToRecord(storedDay(), TODAY).beds, R1: r1 });
    const diagnosed = (r1: PatientData) => beds({ ...r1, cie10Code: 'A00' });
    // Another passport, another episode, the same name.
    const otherPatient = readR1({ rut: 'OTRO-PASAPORTE', clinicalEpisodeId: 'ep_otro' });

    const samePatient = beds(readable());
    preserveCIE10FromPreviousDay(samePatient, diagnosed(readable(PRIOR)));
    const afterReview = beds(otherPatient);
    preserveCIE10FromPreviousDay(afterReview, diagnosed(reviewed(PRIOR)));

    expect(samePatient.R1.cie10Code).toBe('A00');
    expect(afterReview.R1.cie10Code).toBeUndefined();
  });

  it('never files a patient under review in the patient master', async () => {
    vi.useFakeTimers();
    const upsert = vi.spyOn(PatientMasterRepository, 'upsertPatient').mockResolvedValue(undefined);
    const append = vi
      .spyOn(PatientMasterRepository, 'appendHospitalizationEvent')
      .mockResolvedValue(undefined);
    try {
      const day = docToRecord(storedDay({ documentType: 'RUT', rut: 12345678 }), TODAY);
      day.beds.R2.clinicalCrib = {
        ...day.beds.R1,
        bedId: 'R2',
        identityReview: day.beds.R1.identityReview,
      };

      syncPatientsToMasterInBackground(day);
      await vi.runOnlyPendingTimersAsync();

      const filed = upsert.mock.calls.map(([patient]) => patient.rut);
      expect(filed).toEqual(['11.111.111-1', '22.222.222-2']);
    } finally {
      upsert.mockRestore();
      append.mockRestore();
      vi.useRealTimers();
    }
  });

  it('carries what storage held to the next day, nulls included', () => {
    const stored = { documentType: 'Cedula', secondLastName: null, rut: ['FAKE-RUT', null] };

    const next = buildClinicalBedsFromPreviousRecord(
      buildEmptyClinicalBeds(),
      docToRecord(storedDay(stored), TODAY)
    );

    expect(next.R1.identityReview?.stored).toMatchObject(stored);
  });

  it('carries a patient under review to the next day, even with no name or document read', () => {
    const day = docToRecord(
      storedDay({ documentType: 'Pasaporte', patientName: { text: 'X' }, rut: ['FAKE'] }),
      TODAY
    );

    const next = buildClinicalBedsFromPreviousRecord(buildEmptyClinicalBeds(), day);

    expect(next.R1).toMatchObject({
      firstName: 'PACIENTE',
      clinicalEpisodeId: 'ep_synthetic_R1',
      identityReview: { stored: { rut: ['FAKE'], patientName: { text: 'X' } } },
    });
    expect(next.R1.identityReview?.fields).toHaveLength(2);
    expect(next.R2.patientName).toBe('PACIENTE DOS');
  });
});
