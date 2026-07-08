import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { HospitalizationEvent } from '@/types/domain/patientMaster';
import { PatientMasterRepository } from '@/services/repositories/PatientMasterRepository';
import { collectDailyRecordPatientsForMasterSync } from '@/services/repositories/dailyRecordDomainServices';
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

const appendHospitalizationPayload = async (payload: HospitalizationAppendPayload) => {
  await PatientMasterRepository.appendHospitalizationEvent(
    payload.patient,
    payload.event,
    payload.extra
  );
};

const appendHospitalizationSyncPlan = async (syncPlan: HospitalizationSyncPlan | null) => {
  if (!syncPlan) {
    return;
  }

  await appendHospitalizationPayload(syncPlan.appendPayload);

  if (syncPlan.admissionBackfillPayload) {
    await appendHospitalizationPayload(syncPlan.admissionBackfillPayload);
  }
};

const syncHospitalizationPlansToMaster = async <T>(
  items: T[],
  buildSyncPlan: (item: T) => HospitalizationSyncPlan | null
) => {
  for (const item of items) {
    await appendHospitalizationSyncPlan(buildSyncPlan(item));
  }
};

const syncBedPatientsToMaster = async (patientsToSync: MasterSyncDailyRecordPatient[]) => {
  await Promise.all(
    patientsToSync.map(patient =>
      PatientMasterRepository.upsertPatient(
        buildPatientMasterSeed({
          rut: patient.rut!,
          fullName: patient.patientName!,
          birthDate: patient.birthDate,
          forecast: patient.insurance,
          gender: patient.biologicalSex,
        })
      )
    )
  );

  await syncHospitalizationPlansToMaster(patientsToSync, patient =>
    buildAdmissionHospitalizationSyncPlan(patient)
  );
};

const syncDischargesToMaster = async (
  record: DailyRecord,
  existingBedPatientRuts: Set<string>,
  discharges: DailyRecordDischarge[]
) => {
  await syncHospitalizationPlansToMaster(discharges, discharge =>
    buildDischargeHospitalizationSyncPlan({
      existingBedPatientRuts,
      recordDate: record.date,
      discharge,
    })
  );
};

const syncTransfersToMaster = async (
  record: DailyRecord,
  existingBedPatientRuts: Set<string>,
  transfers: DailyRecordTransfer[]
) => {
  await syncHospitalizationPlansToMaster(transfers, transfer =>
    buildTransferHospitalizationSyncPlan({
      existingBedPatientRuts,
      recordDate: record.date,
      transfer,
    })
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
  setTimeout(async () => {
    try {
      const patientsToSync = collectDailyRecordPatientsForMasterSync(record);
      const bedPatientRuts = new Set(patientsToSync.map(p => p.rut));
      await syncBedPatientsToMaster(patientsToSync);
      await syncDischargesToMaster(record, bedPatientRuts, getActiveDischarges(record.discharges));
      await syncTransfersToMaster(record, bedPatientRuts, getActiveTransfers(record.transfers));
    } catch {
      // intentionally ignored (non-critical background sync)
    }
  }, 1000);
};
