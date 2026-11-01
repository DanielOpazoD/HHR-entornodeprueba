import { z } from 'zod';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import type { PatientData } from '../contracts/rayenDomainContracts';
import type { ClinicalFillDeps } from '../contracts/clinicalFillContracts';
import type { DeviceRead } from './clinicalPatientReaders';
import { parseInvasiveDevices } from '../mapping/parseInvasiveDevices';
import {
  mapInvasiveDevices,
  mapRayenInvasiveDeviceEntries,
  type RayenInvasiveDeviceEntry,
} from '../mapping/mapDeviceToInstance';
import { mergeReportDevices, sameDeviceInstallation } from './mergeReportDevices';

// A malformed/partial row cannot certify the absence of any installation.
export const DeviceEntriesSchema = z.array(
  z.object({
    name: z.string().trim().min(1),
    location: z.string().nullish(),
    measuredNumber: z.union([z.number(), z.string()]).nullish(),
    installationDatetime: z.string().nullish(),
    expirationDatetime: z.string().nullish(),
    removedDatetime: z.string().nullish(),
    archived: z.boolean().optional(),
    deleted: z.boolean().optional(),
  })
);

const datedStamp = (raw?: string | null): { date: string; time: string } | undefined => {
  const match = raw?.match(
    /^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/
  );
  if (!match || !z.iso.date().safeParse(match[1]).success) return undefined;
  if (match[4]) {
    const instant = new Date(raw ?? '');
    if (!Number.isFinite(instant.getTime())) return undefined;
    const stamp = calendarStampInClinicalTimeZone(instant);
    return { date: stamp.iso, time: stamp.hhmm };
  }
  return { date: match[1], time: `${match[2]}:${match[3]}` };
};

/** Only today's complete JSON may retire imported instances; manual/legacy origins stay intact. */
const reconcileDeviceRetirements = (
  patient: PatientData,
  entries: RayenInvasiveDeviceEntry[],
  date: string,
  now: Date
): PatientData => {
  const current = calendarStampInClinicalTimeZone(now);
  if (date !== current.iso || !patient.clinicalEpisodeId) return patient;
  const rows = entries.map(entry => ({
    entry,
    installation: mapRayenInvasiveDeviceEntries([
      { ...entry, archived: false, deleted: false, removedDatetime: null },
    ])[0],
  }));
  if (rows.some(row => !datedStamp(row.entry.installationDatetime))) return patient;
  const history = patient.deviceInstanceHistory ?? [];
  const changedTypes = new Set<string>();
  const nextHistory = history.map(item => {
    const installed = datedStamp(`${item.installationDate}T${item.installationTime}`);
    if (
      !installed ||
      `${installed.date}T${installed.time}` > `${current.iso}T${current.hhmm}` ||
      item.status !== 'Active' ||
      item.source !== 'eloisa' ||
      item.clinicalEpisodeId !== patient.clinicalEpisodeId ||
      (item.patientRut && item.patientRut !== patient.rut) ||
      !item.installationDate ||
      !item.installationTime
    )
      return item;
    const matches = rows.filter(row => sameDeviceInstallation(item, row.installation));
    const explicit =
      matches.length === 1 ? datedStamp(matches[0].entry.removedDatetime) : undefined;
    if (matches.length && !explicit) return item;
    if (explicit) {
      const installation = datedStamp(matches[0].entry.installationDatetime)!;
      const stamp = `${explicit.date}T${explicit.time}`;
      if (
        stamp < `${installation.date}T${installation.time}` ||
        stamp > `${current.iso}T${current.hhmm}`
      )
        return item;
      // An explicit event must identify one instance, never an ambiguous pair.
      if (
        history.filter(
          other =>
            other.clinicalEpisodeId === patient.clinicalEpisodeId &&
            sameDeviceInstallation(other, matches[0].installation)
        ).length !== 1
      )
        return item;
    }
    changedTypes.add(item.type);
    const retired = {
      ...item,
      status: 'Removed' as const,
      removalDate: explicit?.date ?? current.iso,
      removalSource: explicit ? ('eloisa' as const) : ('eloisa-absence' as const),
      updatedAt: now.getTime(),
    };
    if (explicit) return { ...retired, removalTime: explicit.time };
    delete retired.removalTime;
    return retired;
  });
  if (!changedTypes.size) return patient;
  const details = { ...patient.deviceDetails };
  const devices = patient.devices.filter(type => {
    if (!changedTypes.has(type)) return true;
    const active = nextHistory.filter(item => item.type === type && item.status === 'Active');
    if (active.length) {
      if (active.length === 1) {
        details[type] = {
          installationDate: active[0].installationDate,
          ...(active[0].note ? { note: active[0].note } : {}),
        };
      } else delete details[type];
      return true;
    }
    const last = nextHistory
      .filter((item, index) => item.type === type && item !== history[index])
      .at(-1);
    details[type] = { ...details[type], removalDate: last?.removalDate };
    return false;
  });
  return { ...patient, devices, deviceDetails: details, deviceInstanceHistory: nextHistory };
};

export const mergeClinicalDeviceRead = (
  patient: PatientData,
  read: DeviceRead,
  date: string,
  deps: Pick<ClinicalFillDeps, 'now' | 'createId'>,
  carryover?: Pick<typeof import('./clinicalCarryoverVerification'), 'verifyCarriedDevices'>
): PatientData => {
  const now = deps.now();
  if (read.source === 'json') DeviceEntriesSchema.parse(read.entries);
  const devices =
    read.source === 'json'
      ? mapRayenInvasiveDeviceEntries(read.entries)
      : mapInvasiveDevices(parseInvasiveDevices(read.textItems));
  const authoritative = read.source === 'json' && date === calendarStampInClinicalTimeZone(now).iso;
  const reconciled = authoritative
    ? reconcileDeviceRetirements(patient, read.entries, date, now)
    : patient;
  const merged = devices.length
    ? mergeReportDevices(reconciled, devices, {
        now,
        createId: deps.createId,
        allowAbsenceReactivation: authoritative,
      })
    : reconciled;
  return carryover?.verifyCarriedDevices(merged, devices) ?? merged;
};
