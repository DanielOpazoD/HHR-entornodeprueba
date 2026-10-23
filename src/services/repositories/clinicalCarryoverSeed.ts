import type { PatientData } from '@/types/domain/patient';
import { deepClone } from '@/utils/deepClone';
import { canCarryClinicalEvidence } from './clinicalCarryoverIdentity';

const documentKey = (value?: string): string =>
  String(value || '')
    .replace(/[.\s-]/g, '')
    .toUpperCase();

/** Only consumes evidence from the same patient/episode; no timestamps are refreshed. */
export const seedClinicalCarryover = (
  source: PatientData,
  destination: PatientData,
  sourceDate: string,
  destinationDate: string
): PatientData => {
  if (!canCarryClinicalEvidence(source, destination, sourceDate, destinationDate))
    return destination;
  const result = deepClone(destination);
  const history = (source.deviceInstanceHistory ?? []).filter(
    item =>
      (!item.clinicalEpisodeId || item.clinicalEpisodeId === source.clinicalEpisodeId) &&
      (!item.patientRut || documentKey(item.patientRut) === documentKey(source.rut))
  );
  result.deviceInstanceHistory = deepClone(history);
  result.devices = [
    ...new Set([
      ...(source.devices ?? []),
      ...history
        .filter(item => item.status === 'Active' && !item.removalDate)
        .map(item => item.type),
    ]),
  ].filter(type => {
    const instances = history.filter(item => item.type === type);
    const foreignOnly =
      (source.deviceInstanceHistory ?? []).some(item => item.type === type) && !instances.length;
    return (
      !foreignOnly &&
      (instances.length
        ? instances.some(item => item.status === 'Active' && !item.removalDate)
        : !source.deviceDetails?.[type]?.removalDate)
    );
  });
  result.deviceDetails = deepClone(
    Object.fromEntries(
      Object.entries(source.deviceDetails ?? {}).filter(([type]) => result.devices.includes(type))
    )
  );
  // Instance evidence takes precedence over the type summary after reinsertion.
  for (const type of result.devices) {
    const active = history.filter(
      item => item.type === type && item.status === 'Active' && !item.removalDate
    );
    if (active.length === 1) {
      result.deviceDetails[type] = {
        installationDate: active[0].installationDate,
        ...(active[0].note ? { note: active[0].note } : {}),
      };
    } else if (active.length > 1) {
      // Preserve all instances without assigning one installation to the whole type.
      delete result.deviceDetails[type];
    }
  }
  const readings = [
    ...(source.vitalSignsHistory ?? []),
    ...(source.vitalSigns ? [source.vitalSigns] : []),
  ].filter(item => {
    const stamp = Date.parse(`${item.recordedDate}T00:00:00Z`);
    if (
      !Number.isFinite(stamp) ||
      new Date(stamp).toISOString().slice(0, 10) !== item.recordedDate ||
      item.recordedDate < source.admissionDate ||
      item.recordedDate > sourceDate
    )
      return false;
    if (item.recordedDate !== source.admissionDate || !source.admissionTime) return true;
    const time = item.recordedAt.match(/(?:T|\s)([0-2]\d:[0-5]\d)(?::\d{2})?(?:$|[.,Z+-])/)?.[1];
    return Boolean(time && Number(time.slice(0, 2)) < 24 && time >= source.admissionTime);
  });
  const unique = new Map(readings.map(item => [item.sourceEventId || JSON.stringify(item), item]));
  result.vitalSignsHistory = deepClone(
    [...unique.values()]
      .sort((a, b) =>
        `${b.recordedDate}|${b.recordedAt}`.localeCompare(`${a.recordedDate}|${a.recordedAt}`)
      )
      .slice(0, 48)
  );
  const glance = result.vitalSignsHistory.find(item =>
    [item.systolic, item.diastolic, item.heartRate, item.spo2, item.temperature].some(
      value => value != null
    )
  );
  if (glance) result.vitalSigns = deepClone(glance);
  else delete result.vitalSigns;
  // Rebuild checkpoints on first verification. Never inherit scales/staffing coverage for data reset
  // on copy, or let a stale validation marker suppress the authoritative read after midnight.
  delete result.clinicalSyncCheckpoint;
  if (result.vitalSignsHistory.length || result.devices.length || history.length) {
    result.clinicalCarryover = {
      sourceDate,
      clinicalEpisodeId: source.clinicalEpisodeId!,
      vitalsPending: result.vitalSignsHistory.length > 0,
      devicesPending: result.devices.length > 0,
    };
  }
  return result;
};
