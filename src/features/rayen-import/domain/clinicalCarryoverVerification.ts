import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import type { PatientData } from '../contracts/rayenDomainContracts';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import type { MappedDevice, RayenInvasiveDeviceEntry } from '../mapping/mapDeviceToInstance';
import {
  mapRayenInvasiveDeviceEntries,
  canonicalizeRayenDeviceType,
} from '../mapping/mapDeviceToInstance';
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

/** Only explicit dated retirements for one identifiable instance are actionable. Missing rows,
 * deleted/archived flags, PDF absence and ambiguous multiple devices never imply removal. */
export const reconcileCarriedDeviceRetirements = (
  patient: PatientData,
  entries: RayenInvasiveDeviceEntry[],
  censusDate: string,
  now: Date
): PatientData => {
  if (
    patient.clinicalCarryover?.clinicalEpisodeId !== patient.clinicalEpisodeId ||
    !patient.clinicalCarryover
  )
    return patient;
  let history = patient.deviceInstanceHistory ?? [];
  let changed = false;
  const current = calendarStampInClinicalTimeZone(now);
  for (const entry of entries) {
    const removal = String(entry.removedDatetime || '').match(
      /^(\d{4}-\d{2}-\d{2})[T ]([0-2]\d:[0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/
    );
    if (!removal || removal[1] > censusDate || Number(removal[2].slice(0, 2)) > 23) continue;
    if (`${removal[1]}T${removal[2]}` > `${current.iso}T${current.hhmm}`) continue;
    const removalStamp = Date.parse(`${removal[1]}T00:00:00Z`);
    if (
      !Number.isFinite(removalStamp) ||
      new Date(removalStamp).toISOString().slice(0, 10) !== removal[1]
    )
      continue;
    const mapped = mapRayenInvasiveDeviceEntries([
      { ...entry, archived: false, deleted: false, removedDatetime: null },
    ])[0];
    if (!mapped?.installationDate || !mapped.installationTime) continue;
    const base = (type: string) =>
      /^VVP#\d+$/i.test(type) ? 'VVP' : canonicalizeRayenDeviceType(type);
    const matches = history.filter(
      item =>
        item.status === 'Active' &&
        item.clinicalEpisodeId === patient.clinicalEpisodeId &&
        base(item.type) === base(mapped.type) &&
        item.installationDate === mapped.installationDate &&
        item.installationTime === mapped.installationTime
    );
    if (
      matches.length !== 1 ||
      `${removal[1]}T${removal[2]}` < `${mapped.installationDate}T${mapped.installationTime}`
    )
      continue;
    history = history.map(item =>
      item === matches[0]
        ? {
            ...item,
            status: 'Removed' as const,
            removalDate: removal[1],
            removalTime: removal[2],
            updatedAt: now.getTime(),
          }
        : item
    );
    changed = true;
  }
  if (!changed) return patient;
  const devices = patient.devices.filter(
    type =>
      !history.some(item => item.type === type && item.status === 'Removed') ||
      history.some(item => item.type === type && item.status === 'Active')
  );
  const details = { ...patient.deviceDetails };
  for (const type of patient.devices.filter(type => !devices.includes(type))) {
    const last = history.filter(item => item.type === type && item.status === 'Removed').at(-1);
    details[type] = { ...details[type], removalDate: last?.removalDate };
  }
  return { ...patient, devices, deviceDetails: details, deviceInstanceHistory: history };
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
