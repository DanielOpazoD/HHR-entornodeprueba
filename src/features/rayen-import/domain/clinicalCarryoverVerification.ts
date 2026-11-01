import type { PatientData } from '../contracts/rayenDomainContracts';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import type { MappedDevice } from '../mapping/mapDeviceToInstance';
import { canonicalizeRayenDeviceType } from '../mapping/mapDeviceToInstance';
import { clinicalValuesEqual } from './clinicalIncrementalSync';

export const verifyCarriedVitals = (
  patient: PatientData,
  readings: PatientVitalSigns[]
): PatientData => {
  const carried = patient.clinicalCarryover;
  if (!carried?.vitalsPending || carried.clinicalEpisodeId !== patient.clinicalEpisodeId)
    return patient;
  const previous = (patient.vitalSignsHistory ?? []).filter(
    item => item.recordedDate <= carried.sourceDate
  );
  const verified =
    previous.length > 0 &&
    previous.every(old =>
      readings.some(item =>
        old.sourceEventId
          ? item.sourceEventId === old.sourceEventId
          : clinicalValuesEqual(item, old)
      )
    );
  return verified
    ? { ...patient, clinicalCarryover: { ...carried, vitalsPending: false } }
    : patient;
};

export const verifyCarriedDevices = (
  patient: PatientData,
  devices: MappedDevice[]
): PatientData => {
  const carried = patient.clinicalCarryover;
  if (!carried?.devicesPending || carried.clinicalEpisodeId !== patient.clinicalEpisodeId)
    return patient;
  const base = (type: string) =>
    /^VVP#\d+$/i.test(type) ? 'VVP' : canonicalizeRayenDeviceType(type);
  const active = (patient.deviceInstanceHistory ?? []).filter(item => item.status === 'Active');
  // Every remaining device needs positive dated evidence; untracked/manual devices stay pending.
  const verified =
    patient.devices.every(type => active.some(item => item.type === type)) &&
    active.every(
      item =>
        item.clinicalEpisodeId === patient.clinicalEpisodeId &&
        Boolean(item.installationDate && item.installationTime) &&
        devices.some(
          device =>
            base(device.type) === base(item.type) &&
            device.installationDate === item.installationDate &&
            device.installationTime === item.installationTime
        )
    );
  return verified
    ? { ...patient, clinicalCarryover: { ...carried, devicesPending: false } }
    : patient;
};
