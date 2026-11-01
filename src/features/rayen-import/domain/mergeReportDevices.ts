/**
 * Merges the invasive devices parsed from a patient's Ficha Médico PDF into their HHR device
 * model (`devices` / `deviceDetails` / `deviceInstanceHistory`). Self-contained on purpose: the
 * census device controller can't be imported here (census already depends on rayen-import, so
 * that would be a circular feature dependency). Matches installation identity before type labels;
 * only a current JSON read may undo a retirement inferred from absence.
 */

import type { PatientData } from '../contracts/rayenDomainContracts';
import type { DeviceDetails, DeviceInstance } from '@/types/domain/devices';
import type { MappedDevice } from '../mapping/mapDeviceToInstance';
import { canonicalizeRayenDeviceType } from '../mapping/mapDeviceToInstance';
import { clinicalFieldValuesEqual } from './clinicalFieldCanonicalization';
import { clinicalValuesEqual } from './clinicalIncrementalSync';

export interface MergeDevicesContext {
  now: Date;
  createId: () => string;
  allowAbsenceReactivation?: boolean;
}

const buildNote = (device: MappedDevice): string =>
  [device.location, device.note].filter(part => part.trim().length > 0).join(' · ');

export const sameDeviceInstallation = (
  item: Pick<DeviceInstance, 'type' | 'installationDate' | 'installationTime' | 'source'>,
  device: MappedDevice
): boolean =>
  canonicalizeRayenDeviceType(item.type) === canonicalizeRayenDeviceType(device.type) &&
  Boolean(item.installationDate && item.installationTime) &&
  ((item.installationDate === device.installationDate &&
    item.installationTime === device.installationTime) ||
    (!item.source &&
      item.installationDate === device.legacyInstallation?.date &&
      item.installationTime === device.legacyInstallation?.time));

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
  const devicesNeedDeduplication = (patient.devices ?? []).length !== devices.length;

  if (
    !devicesNeedDeduplication &&
    clinicalFieldValuesEqual('devices', patient.devices, devices) &&
    clinicalFieldValuesEqual('deviceDetails', patient.deviceDetails, deviceDetails) &&
    clinicalFieldValuesEqual(
      'deviceInstanceHistory',
      patient.deviceInstanceHistory,
      deviceInstanceHistory
    )
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

  for (const incoming of devices) {
    const owned = (item: DeviceInstance) =>
      item.clinicalEpisodeId === patient.clinicalEpisodeId &&
      (!item.patientRut || item.patientRut === patient.rut);
    const matches = history.filter(item => owned(item) && sameDeviceInstallation(item, incoming));
    if (
      matches.length > 1 ||
      history.some(
        item =>
          !item.clinicalEpisodeId &&
          (!item.patientRut || item.patientRut === patient.rut) &&
          item.status === 'Removed' &&
          sameDeviceInstallation(item, incoming)
      )
    )
      continue;
    // Undated PDF rows remain additive/idempotent, but cannot establish retirement identity.
    const undated =
      matches.length === 0 && !patient.clinicalCarryover
        ? history.filter(
            item =>
              item.type === incoming.type &&
              item.status === 'Active' &&
              item.source !== 'manual' &&
              (!item.clinicalEpisodeId || owned(item)) &&
              (!item.installationTime || !incoming.installationDate || !incoming.installationTime)
          )
        : [];
    const matching = matches[0] ?? (undated.length === 1 ? undated[0] : undefined);
    const reactivating =
      matching?.status === 'Removed' &&
      matching.source !== 'manual' &&
      matching.removalSource === 'eloisa-absence' &&
      ctx.allowAbsenceReactivation;
    // Nursing/explicit/legacy retirements are never undone by an old source row.
    if (matching?.status === 'Removed' && !reactivating) continue;
    let device = matching
      ? {
          ...incoming,
          type: matching.type,
        }
      : incoming;
    if (
      !matching &&
      /^VVP#\d+$/i.test(device.type) &&
      (activeTypes.has(device.type) || history.some(item => item.type === device.type))
    ) {
      let number = 1;
      while (
        activeTypes.has(`VVP#${number}`) ||
        history.some(item => item.type === `VVP#${number}`)
      )
        number++;
      device = { ...incoming, type: `VVP#${number}` };
    }
    activeTypes.add(device.type);
    const note = buildNote(device);
    deviceDetails[device.type] = {
      ...(deviceDetails[device.type] ?? {}),
      installationDate: device.installationDate || deviceDetails[device.type]?.installationDate,
      note: note || deviceDetails[device.type]?.note,
    };

    delete deviceDetails[device.type].removalDate;
    const activeIdx = matching
      ? history.indexOf(matching)
      : history.findIndex(
          item =>
            item.type === device.type &&
            item.status === 'Active' &&
            item.source !== 'manual' &&
            // Retain the legacy undated PDF refresh, without claiming its unknown origin.
            !item.installationTime &&
            !patient.clinicalCarryover &&
            (!item.clinicalEpisodeId || owned(item))
        );
    if (activeIdx >= 0) {
      const current = history[activeIdx];
      const refreshed = {
        ...history[activeIdx],
        // A dated source row proves an unmarked instance came from Eloísa.
        ...(matches[0] && !current.source ? { source: 'eloisa' as const } : {}),
        status: 'Active' as const,
        installationDate: device.installationDate || history[activeIdx].installationDate,
        installationTime: device.installationTime || history[activeIdx].installationTime,
        location: device.location || history[activeIdx].location,
        note: note || history[activeIdx].note,
      };
      if (reactivating) {
        delete refreshed.removalDate;
        delete refreshed.removalTime;
        delete refreshed.removalSource;
      }
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
        source: 'eloisa',
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
    clinicalFieldValuesEqual('devices', normalizedPatient.devices, merged.devices) &&
    clinicalFieldValuesEqual(
      'deviceDetails',
      normalizedPatient.deviceDetails,
      merged.deviceDetails
    ) &&
    clinicalFieldValuesEqual(
      'deviceInstanceHistory',
      normalizedPatient.deviceInstanceHistory,
      merged.deviceInstanceHistory
    )
  ) {
    return normalizedPatient;
  }
  return merged;
};
