import type { PatientData } from '../contracts/rayenDomainContracts';
import type { ClinicalFillDeps } from '../contracts/clinicalFillContracts';
import type { DeviceRead } from './clinicalPatientReaders';
import { parseInvasiveDevices } from '../mapping/parseInvasiveDevices';
import { mapInvasiveDevices, mapRayenInvasiveDeviceEntries } from '../mapping/mapDeviceToInstance';
import { mergeReportDevices } from './mergeReportDevices';

type CarryoverVerification = Pick<
  typeof import('./clinicalCarryoverVerification'),
  'reconcileCarriedDeviceRetirements' | 'verifyCarriedDevices'
>;

/** Merge a successful source read; absence is never evidence of device removal. */
export const mergeClinicalDeviceRead = (
  patient: PatientData,
  read: DeviceRead,
  date: string,
  deps: Pick<ClinicalFillDeps, 'now' | 'createId'>,
  carryover?: CarryoverVerification
): PatientData => {
  const devices =
    read.source === 'json'
      ? mapRayenInvasiveDeviceEntries(read.entries)
      : mapInvasiveDevices(parseInvasiveDevices(read.textItems));
  let merged = patient;
  if (read.source === 'json' && carryover) {
    merged = carryover.reconcileCarriedDeviceRetirements(merged, read.entries, date, deps.now());
  }
  // Empty lists must not remove devices nursing keeps by hand.
  if (devices.length > 0) {
    merged = mergeReportDevices(merged, devices, { now: deps.now(), createId: deps.createId });
  }
  return carryover?.verifyCarriedDevices(merged, devices) ?? merged;
};
