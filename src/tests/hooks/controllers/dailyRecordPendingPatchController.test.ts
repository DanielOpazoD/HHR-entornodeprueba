import { afterEach, describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { PatientStatus } from '@/types/domain/patientClassification';
import {
  PENDING_DAILY_RECORD_PATCH_STORAGE_KEY,
  applyPendingExplicitCensusPatch,
  clearPendingDailyRecordPatchesForTests,
  registerPendingDailyRecordPatch,
  releaseConfirmedPendingDailyRecordPatches,
} from '@/hooks/controllers/dailyRecordPendingPatchController';
import { resetSyncMutationIdentityForTests } from '@/services/storage/sync/syncMutationIdentity';

const FIXED_PENDING_PATCH_CREATED_AT = 4102444740000;
const FIXED_PENDING_PATCH_EXPIRES_AT = FIXED_PENDING_PATCH_CREATED_AT + 60_000;

describe('dailyRecordPendingPatchController', () => {
  afterEach(() => {
    clearPendingDailyRecordPatchesForTests();
    resetSyncMutationIdentityForTests();
  });

  it('keeps a pending clinical status patch while the remote snapshot has not confirmed it', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    previousRecord.beds.R1.clinicalEpisodeId = undefined;
    previousRecord.beds.R1.rut = '11.111.111-1';
    previousRecord.beds.R1.admissionDate = '2025-01-08';
    previousRecord.beds.R1.admissionTime = '08:00';
    previousRecord.beds.R1.status = PatientStatus.GRAVE;

    const incomingRecord = DataFactory.createMockDailyRecord('2025-01-08');
    incomingRecord.beds.R1.clinicalEpisodeId = 'ep-r1-from-firestore';
    incomingRecord.beds.R1.rut = '11.111.111-1';
    incomingRecord.beds.R1.admissionDate = '2025-01-08';
    incomingRecord.beds.R1.admissionTime = '08:00';
    incomingRecord.beds.R1.status = PatientStatus.EMPTY;

    registerPendingDailyRecordPatch('2025-01-08', {
      'beds.R1.status': PatientStatus.GRAVE,
    });

    releaseConfirmedPendingDailyRecordPatches('2025-01-08', incomingRecord, previousRecord);
    const resolved = applyPendingExplicitCensusPatch('2025-01-08', incomingRecord, previousRecord);

    expect(resolved.beds.R1.status).toBe(PatientStatus.GRAVE);
  });

  it('releases a pending clinical status patch once the remote snapshot confirms the value', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    previousRecord.beds.R1.clinicalEpisodeId = undefined;
    previousRecord.beds.R1.rut = '11.111.111-1';
    previousRecord.beds.R1.admissionDate = '2025-01-08';
    previousRecord.beds.R1.admissionTime = '08:00';
    previousRecord.beds.R1.status = PatientStatus.GRAVE;

    const confirmedRecord = DataFactory.createMockDailyRecord('2025-01-08');
    confirmedRecord.beds.R1.clinicalEpisodeId = 'ep-r1-from-firestore';
    confirmedRecord.beds.R1.rut = '11.111.111-1';
    confirmedRecord.beds.R1.admissionDate = '2025-01-08';
    confirmedRecord.beds.R1.admissionTime = '08:00';
    confirmedRecord.beds.R1.status = PatientStatus.GRAVE;

    const laterIncomingRecord = {
      ...confirmedRecord,
      beds: {
        ...confirmedRecord.beds,
        R1: {
          ...confirmedRecord.beds.R1,
          status: PatientStatus.EMPTY,
        },
      },
    };

    registerPendingDailyRecordPatch('2025-01-08', {
      'beds.R1.status': PatientStatus.GRAVE,
    });

    releaseConfirmedPendingDailyRecordPatches('2025-01-08', confirmedRecord, previousRecord);
    const resolved = applyPendingExplicitCensusPatch(
      '2025-01-08',
      laterIncomingRecord,
      confirmedRecord
    );

    expect(resolved.beds.R1.status).toBe(PatientStatus.EMPTY);
  });

  it('retargets a pending clinical status patch when the same episode moved to another bed', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    previousRecord.beds.R1.clinicalEpisodeId = 'ep-r1-active';
    previousRecord.beds.R1.rut = '11.111.111-1';
    previousRecord.beds.R1.admissionDate = '2025-01-08';
    previousRecord.beds.R1.admissionTime = '08:00';
    previousRecord.beds.R1.status = PatientStatus.GRAVE;

    const movedRecord = DataFactory.createMockDailyRecord('2025-01-08');
    movedRecord.beds.R1.clinicalEpisodeId = undefined;
    movedRecord.beds.R1.rut = '';
    movedRecord.beds.R1.admissionDate = '';
    movedRecord.beds.R1.admissionTime = '';
    movedRecord.beds.R1.status = PatientStatus.EMPTY;
    movedRecord.beds.R2.clinicalEpisodeId = 'ep-r1-active';
    movedRecord.beds.R2.rut = '11.111.111-1';
    movedRecord.beds.R2.admissionDate = '2025-01-08';
    movedRecord.beds.R2.admissionTime = '08:00';
    movedRecord.beds.R2.status = PatientStatus.ESTABLE;

    registerPendingDailyRecordPatch('2025-01-08', {
      'beds.R1.status': PatientStatus.GRAVE,
    });

    releaseConfirmedPendingDailyRecordPatches('2025-01-08', movedRecord, previousRecord);
    const resolved = applyPendingExplicitCensusPatch('2025-01-08', movedRecord, previousRecord);

    expect(resolved.beds.R1.status).toBe(PatientStatus.EMPTY);
    expect(resolved.beds.R2.status).toBe(PatientStatus.GRAVE);
  });

  it('hydrates pending census patches from persisted storage for another tab or reload', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    previousRecord.beds.R1.clinicalEpisodeId = undefined;
    previousRecord.beds.R1.rut = '11.111.111-1';
    previousRecord.beds.R1.admissionDate = '2025-01-08';
    previousRecord.beds.R1.admissionTime = '08:00';
    previousRecord.beds.R1.status = PatientStatus.GRAVE;

    const incomingRecord = DataFactory.createMockDailyRecord('2025-01-08');
    incomingRecord.beds.R1.clinicalEpisodeId = 'ep-r1-from-firestore';
    incomingRecord.beds.R1.rut = '11.111.111-1';
    incomingRecord.beds.R1.admissionDate = '2025-01-08';
    incomingRecord.beds.R1.admissionTime = '08:00';
    incomingRecord.beds.R1.status = PatientStatus.EMPTY;

    localStorage.setItem(
      PENDING_DAILY_RECORD_PATCH_STORAGE_KEY,
      JSON.stringify({
        '2025-01-08': [
          {
            id: 'persisted-patch-1',
            mutationId: 'mutation-persisted-1',
            clientId: 'client-persisted',
            tabId: 'tab-other',
            createdAt: FIXED_PENDING_PATCH_CREATED_AT,
            expiresAt: FIXED_PENDING_PATCH_EXPIRES_AT,
            patch: {
              'beds.R1.status': PatientStatus.GRAVE,
            },
          },
        ],
      })
    );

    const resolved = applyPendingExplicitCensusPatch('2025-01-08', incomingRecord, previousRecord);

    expect(resolved.beds.R1.status).toBe(PatientStatus.GRAVE);
  });

  it('removes a persisted pending patch once the remote snapshot confirms it', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    previousRecord.beds.R1.clinicalEpisodeId = undefined;
    previousRecord.beds.R1.rut = '11.111.111-1';
    previousRecord.beds.R1.admissionDate = '2025-01-08';
    previousRecord.beds.R1.admissionTime = '08:00';
    previousRecord.beds.R1.status = PatientStatus.GRAVE;

    const confirmedRecord = DataFactory.createMockDailyRecord('2025-01-08');
    confirmedRecord.beds.R1.clinicalEpisodeId = 'ep-r1-from-firestore';
    confirmedRecord.beds.R1.rut = '11.111.111-1';
    confirmedRecord.beds.R1.admissionDate = '2025-01-08';
    confirmedRecord.beds.R1.admissionTime = '08:00';
    confirmedRecord.beds.R1.status = PatientStatus.GRAVE;

    registerPendingDailyRecordPatch('2025-01-08', {
      'beds.R1.status': PatientStatus.GRAVE,
    });

    expect(localStorage.getItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY)).toContain(
      'beds.R1.status'
    );

    releaseConfirmedPendingDailyRecordPatches('2025-01-08', confirmedRecord, previousRecord);

    expect(localStorage.getItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY)).toBeNull();
  });
});
