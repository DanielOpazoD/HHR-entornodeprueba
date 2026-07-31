/**
 * Merges the invasive devices parsed from a patient's Ficha Médico PDF into their HHR device
 * model (`devices` / `deviceDetails` / `deviceInstanceHistory`). Self-contained on purpose: the
 * census device controller can't be imported here (census already depends on rayen-import, so
 * that would be a circular feature dependency). Additive + idempotent — it never removes a device
 * the nurse manages, and re-running only refreshes an already-Active instance in place.
 */

import type { PatientData } from '../contracts/rayenDomainContracts';
import type { DeviceDetails, DeviceInstance } from '@/types/domain/devices';
import type { MappedDevice } from '../mapping/mapDeviceToInstance';
import { canonicalizeRayenDeviceType } from '../mapping/mapDeviceToInstance';
import { clinicalValuesEqual } from './clinicalIncrementalSync';

export interface MergeDevicesContext {
  now: Date;
  createId: () => string;
}

const buildNote = (device: MappedDevice): string =>
  [device.location, device.note].filter(part => part.trim().length > 0).join(' · ');

const canonicalizePersistedDeviceType = (type: string): string =>
  /^VVP#\d+$/i.test(type.trim()) ? type.trim().toUpperCase() : canonicalizeRayenDeviceType(type);

const normalizeExistingDeviceAliases = (patient: PatientData): PatientData => {
  const devices = [...new Set((patient.devices ?? []).map(canonicalizePersistedDeviceType))];
  const deviceDetails = Object.entries(patient.deviceDetails ?? {}).reduce<DeviceDetails>(
    (result, [type, details]) => {
      const canonical = canonicalizePersistedDeviceType(type);
      const existing = result[canonical] ?? {};
      result[canonical] =
        type === canonical ? { ...existing, ...details } : { ...details, ...existing };
      return result;
    },
    {}
  );
  const deviceInstanceHistory = (patient.deviceInstanceHistory ?? []).map(instance => {
    const canonical = canonicalizePersistedDeviceType(instance.type);
    return canonical === instance.type ? instance : { ...instance, type: canonical };
  });

  if (
    clinicalValuesEqual(patient.devices ?? [], devices) &&
    clinicalValuesEqual(patient.deviceDetails ?? {}, deviceDetails) &&
    clinicalValuesEqual(patient.deviceInstanceHistory ?? [], deviceInstanceHistory)
  ) {
    return patient;
  }
  return { ...patient, devices, deviceDetails, deviceInstanceHistory };
};

export const mergeReportDevices = (
  patient: PatientData,
  devices: MappedDevice[],
  ctx: MergeDevicesContext
): PatientData => {
  const normalizedPatient = normalizeExistingDeviceAliases(patient);
  if (devices.length === 0) return normalizedPatient;

  const nowMs = ctx.now.getTime();
  const history: DeviceInstance[] = [...(normalizedPatient.deviceInstanceHistory ?? [])];
  const deviceDetails: DeviceDetails = { ...(normalizedPatient.deviceDetails ?? {}) };
  const activeTypes = new Set(normalizedPatient.devices ?? []);

  for (const device of devices) {
    activeTypes.add(device.type);
    const note = buildNote(device);
    deviceDetails[device.type] = {
      ...(deviceDetails[device.type] ?? {}),
      installationDate: device.installationDate || deviceDetails[device.type]?.installationDate,
      note: note || deviceDetails[device.type]?.note,
    };

    const activeIdx = history.findIndex(
      item => item.type === device.type && item.status === 'Active'
    );
    if (activeIdx >= 0) {
      const current = history[activeIdx];
      const refreshed = {
        ...history[activeIdx],
        installationDate: device.installationDate || history[activeIdx].installationDate,
        installationTime: device.installationTime || history[activeIdx].installationTime,
        location: device.location || history[activeIdx].location,
        note: note || history[activeIdx].note,
      };
      history[activeIdx] = clinicalValuesEqual(current, refreshed)
        ? current
        : { ...refreshed, updatedAt: nowMs };
    } else {
      history.push({
        id: ctx.createId(),
        type: device.type,
        clinicalEpisodeId: normalizedPatient.clinicalEpisodeId,
        patientRut: normalizedPatient.rut,
        patientName: normalizedPatient.patientName,
        status: 'Active',
        installationDate: device.installationDate,
        installationTime: device.installationTime,
        location: device.location,
        note,
        createdAt: nowMs,
        updatedAt: nowMs,
      });
    }
  }

  const merged = {
    ...normalizedPatient,
    devices: [...activeTypes],
    deviceDetails,
    deviceInstanceHistory: history,
  };
  if (
    clinicalValuesEqual(normalizedPatient.devices ?? [], merged.devices) &&
    clinicalValuesEqual(normalizedPatient.deviceDetails ?? {}, merged.deviceDetails) &&
    clinicalValuesEqual(normalizedPatient.deviceInstanceHistory ?? [], merged.deviceInstanceHistory)
  ) {
    return normalizedPatient;
  }
  return merged;
};
