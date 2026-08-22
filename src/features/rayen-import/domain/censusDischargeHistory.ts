import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import { normalizePatientRut } from './censusPatientIdentityIndex';

export const createDischargedEncounterMatcher = (
  current: DailyRecord
): ((encounter: RayenEncounter) => boolean) => {
  const episodes = new Set<string>();
  const runsWithoutEpisode = new Set<string>();
  for (const record of [
    ...(current.discharges ?? []),
    ...(current.cma ?? []),
    ...(current.transfers ?? []),
  ]) {
    if (record.deletedAt) continue;
    const recordRut = normalizePatientRut(record.rut);
    if (record.clinicalEpisodeId) episodes.add(record.clinicalEpisodeId);
    else if (recordRut) runsWithoutEpisode.add(recordRut);
  }
  return encounter =>
    episodes.has(encounter.encounterId) ||
    runsWithoutEpisode.has(normalizePatientRut(encounter.run));
};
