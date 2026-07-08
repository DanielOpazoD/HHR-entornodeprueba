import type { PatientData } from '@/services/contracts/patientServiceContracts';
import {
  EXPLICIT_LOCAL_CENSUS_PATCH_FIELDS,
  isSameEpisodeForExplicitCensusPatch,
} from '@/services/repositories/explicitLocalCensusPatchPolicy';
import { isPlainObject } from '@/services/repositories/conflictResolutionUtils';

const isEmptyClinicalValue = (value: unknown): boolean =>
  value === '' ||
  value === null ||
  value === undefined ||
  (Array.isArray(value) && value.length === 0);

export const shouldKeepExplicitLocalCensusValue = (
  key: string,
  remotePatient: PatientData | undefined,
  localPatient: PatientData | undefined,
  remoteValue: unknown,
  localValue: unknown
): boolean =>
  EXPLICIT_LOCAL_CENSUS_PATCH_FIELDS.has(key) &&
  isSameEpisodeForExplicitCensusPatch(remotePatient, localPatient) &&
  isEmptyClinicalValue(remoteValue) &&
  !isEmptyClinicalValue(localValue);

export const filterDeviceDetailsToActiveOrRetired = (patient: Record<string, unknown>): void => {
  const devices = Array.isArray(patient.devices) ? patient.devices.map(String) : [];
  const deviceDetails = isPlainObject(patient.deviceDetails)
    ? (patient.deviceDetails as Record<string, unknown>)
    : null;

  if (!deviceDetails) {
    return;
  }

  const activeDevices = new Set(devices);
  patient.deviceDetails = Object.fromEntries(
    Object.entries(deviceDetails).filter(([device, details]) => {
      const removalDate = isPlainObject(details)
        ? String((details as Record<string, unknown>).removalDate || '').trim()
        : '';
      return activeDevices.has(device) || Boolean(removalDate);
    })
  );
};
