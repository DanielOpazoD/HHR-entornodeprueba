import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionEpoch } from '@/services/storage/sessionStorageTransition';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { HospitalizationEvent } from '@/types/domain/patientMaster';
import { PatientMasterRepository } from '@/services/repositories/PatientMasterRepository';
import { collectDailyRecordPatientsForMasterSync } from '@/services/repositories/dailyRecordClinicalDomainService';
import {
  buildAdmissionHospitalizationSyncPlan,
  buildDischargeHospitalizationSyncPlan,
  buildPatientMasterSeed,
  buildTransferHospitalizationSyncPlan,
} from '@/services/repositories/dailyRecordMasterSyncController';
import {
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';

type MasterSyncDailyRecordPatient = ReturnType<
  typeof collectDailyRecordPatientsForMasterSync
>[number];
type DailyRecordDischarge = NonNullable<DailyRecord['discharges']>[number];
type DailyRecordTransfer = NonNullable<DailyRecord['transfers']>[number];

type HospitalizationAppendPayload = {
  patient: {
    rut: string;
    fullName: string;
    birthDate?: string;
    forecast?: string;
    gender?: string;
  };
  event: HospitalizationEvent;
  extra?: {
    lastAdmission?: string;
    lastDischarge?: string;
    vitalStatus?: 'Vivo' | 'Fallecido';
  };
};

type HospitalizationSyncPlan = {
  appendPayload: HospitalizationAppendPayload;
  admissionBackfillPayload?: HospitalizationAppendPayload | null;
};

const appendHospitalizationPayload = async (
  payload: HospitalizationAppendPayload,
  isCurrentSession: () => boolean
) => {
  if (!isCurrentSession()) return;
  await PatientMasterRepository.appendHospitalizationEvent(
    payload.patient,
    payload.event,
    payload.extra
  );
};

const appendHospitalizationSyncPlan = async (
  syncPlan: HospitalizationSyncPlan | null,
  isCurrentSession: () => boolean
) => {
  if (!syncPlan) {
    return;
  }

  await appendHospitalizationPayload(syncPlan.appendPayload, isCurrentSession);

  if (syncPlan.admissionBackfillPayload) {
    await appendHospitalizationPayload(syncPlan.admissionBackfillPayload, isCurrentSession);
  }
};

const syncHospitalizationPlansToMaster = async <T>(
  items: T[],
  buildSyncPlan: (item: T) => HospitalizationSyncPlan | null,
  isCurrentSession: () => boolean
) => {
  for (const item of items) {
    if (!isCurrentSession()) return;
    await appendHospitalizationSyncPlan(buildSyncPlan(item), isCurrentSession);
  }
};

const syncBedPatientsToMaster = async (
  patientsToSync: MasterSyncDailyRecordPatient[],
  isCurrentSession: () => boolean
) => {
  await Promise.all(
    patientsToSync.map(patient => {
      if (!isCurrentSession()) return;
      return PatientMasterRepository.upsertPatient(
        buildPatientMasterSeed({
          rut: patient.rut!,
          fullName: patient.patientName!,
          birthDate: patient.birthDate,
          forecast: patient.insurance,
          gender: patient.biologicalSex,
          // Capture the Rayen encId from the active census on every save, so a late-arriving id
          // (synced after admission) is still recorded before the patient is discharged.
          clinicalEpisodeId: patient.clinicalEpisodeId,
        })
      );
    })
  );

  await syncHospitalizationPlansToMaster(
    patientsToSync,
    patient => buildAdmissionHospitalizationSyncPlan(patient),
    isCurrentSession
  );
};

const syncDischargesToMaster = async (
  record: DailyRecord,
  existingBedPatientRuts: Set<string>,
  discharges: DailyRecordDischarge[],
  isCurrentSession: () => boolean
) => {
  await syncHospitalizationPlansToMaster(
    discharges,
    discharge =>
      buildDischargeHospitalizationSyncPlan({
        existingBedPatientRuts,
        recordDate: record.date,
        discharge,
      }),
    isCurrentSession
  );
};

const syncTransfersToMaster = async (
  record: DailyRecord,
  existingBedPatientRuts: Set<string>,
  transfers: DailyRecordTransfer[],
  isCurrentSession: () => boolean
) => {
  await syncHospitalizationPlansToMaster(
    transfers,
    transfer =>
      buildTransferHospitalizationSyncPlan({
        existingBedPatientRuts,
        recordDate: record.date,
        transfer,
      }),
    isCurrentSession
  );
};

/**
 * Real-time sync of patient master index when a daily record is saved.
 *
 * Runs in the background (non-blocking, fire-and-forget) and syncs:
 *  1. Demographics for patients currently in beds
 *  2. Ingreso events for patients in beds
 *  3. Egreso events from discharges
 *  4. Traslado events from transfers
 */
export const syncPatientsToMasterInBackground = (record: DailyRecord): void => {
  const owner = getStoredSessionOwnerKey();
  const epoch = getSessionEpoch();
  const isCurrentSession = () =>
    owner === getStoredSessionOwnerKey() && epoch === getSessionEpoch();

  setTimeout(async () => {
    try {
      const patientsToSync = collectDailyRecordPatientsForMasterSync(record);
      const bedPatientRuts = new Set(patientsToSync.map(p => p.rut));
      await syncBedPatientsToMaster(patientsToSync, isCurrentSession);
      await syncDischargesToMaster(
        record,
        bedPatientRuts,
        getActiveDischarges(record.discharges),
        isCurrentSession
      );
      await syncTransfersToMaster(
        record,
        bedPatientRuts,
        getActiveTransfers(record.transfers),
        isCurrentSession
      );
    } catch {
      // intentionally ignored (non-critical background sync)
    }
  }, 1000);
};
