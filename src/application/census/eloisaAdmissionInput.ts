import type { AdmitPatientInput } from '@/application/daily-record/commands/admitPatientCommand';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import {
  buildEloisaPatientDisplayName,
  type EloisaManualPatientPayload,
} from '@/features/rayen-manual-import';
import {
  mapRayenInvasiveDeviceEntries,
  mergeReportDevices,
} from '@/features/rayen-import/census-status';

/** Translate captured clinical data; persistence and availability checks stay with the caller. */
export const buildEloisaAdmissionInput = (
  payload: EloisaManualPatientPayload,
  targetBedId: string,
  runtime: { now: Date; createId: () => string }
): Omit<AdmitPatientInput, 'actor' | 'recordDate' | 'baseRecord'> => {
  const patientName = buildEloisaPatientDisplayName(payload);
  const patientWithDevices = mergeReportDevices(
    {
      ...createEmptyPatient(targetBedId),
      patientName,
      rut: payload.rut,
      clinicalEpisodeId: payload.encounterId,
    },
    mapRayenInvasiveDeviceEntries(payload.deviceEntries),
    runtime
  );
  return {
    bedId: targetBedId,
    patientName,
    firstName: [payload.firstName, payload.middleNames].filter(Boolean).join(' '),
    lastName: payload.lastName,
    secondLastName: payload.secondLastName,
    rut: payload.rut,
    birthDate: payload.birthDate,
    biologicalSex: payload.biologicalSex,
    admissionDate: payload.admissionDate,
    admissionTime: payload.admissionTime,
    pathology: payload.diagnosis,
    devices: patientWithDevices.devices.length ? patientWithDevices.devices : payload.devices,
    deviceDetails: patientWithDevices.deviceDetails,
    deviceInstanceHistory: patientWithDevices.deviceInstanceHistory,
    clinicalEpisodeId: payload.encounterId,
    eloisaManualAdmissionSource: {
      method: 'eloisa_manual_code',
      capturedAt: payload.capturedAt,
      formatVersion: payload.version,
      encounterId: payload.encounterId,
      encounterRoute: payload.encounterRoute,
    },
  };
};
