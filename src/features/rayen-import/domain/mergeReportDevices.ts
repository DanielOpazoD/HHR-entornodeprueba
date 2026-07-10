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

export interface MergeDevicesContext {
  now: Date;
  createId: () => string;
}

const buildNote = (device: MappedDevice): string =>
  [device.location, device.note].filter(part => part.trim().length > 0).join(' · ');

export const mergeReportDevices = (
  patient: PatientData,
  devices: MappedDevice[],
  ctx: MergeDevicesContext
): PatientData => {
  if (devices.length === 0) return patient;

  const nowMs = ctx.now.getTime();
  const history: DeviceInstance[] = [...(patient.deviceInstanceHistory ?? [])];
  const deviceDetails: DeviceDetails = { ...(patient.deviceDetails ?? {}) };
  const activeTypes = new Set(patient.devices ?? []);

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
      history[activeIdx] = {
        ...history[activeIdx],
        installationDate: device.installationDate || history[activeIdx].installationDate,
        installationTime: device.installationTime || history[activeIdx].installationTime,
        location: device.location || history[activeIdx].location,
        note: note || history[activeIdx].note,
        updatedAt: nowMs,
      };
    } else {
      history.push({
        id: ctx.createId(),
        type: device.type,
        clinicalEpisodeId: patient.clinicalEpisodeId,
        patientRut: patient.rut,
        patientName: patient.patientName,
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

  return {
    ...patient,
    devices: [...activeTypes],
    deviceDetails,
    deviceInstanceHistory: history,
  };
};
