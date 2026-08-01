import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenCensusSnapshot, RayenEncounter } from '../contracts/rayenSnapshot';
import { isDischargedEncounter } from './censusReconciliationPredicates';
import { buildActiveBedEvidence } from './gestionCamasActiveBedPolicy';

const normalizeLocation = (value: string | undefined): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/**
 * P-R1 and P-R2 are temporary post-anaesthesia recovery positions, not beds in the HHR inpatient
 * census. Active encounters there must not create admissions, clinical enrichment or warnings.
 */
export const isPavilionRecoveryLocation = (value: string | undefined): boolean => {
  const matchesToken = (candidate: string): boolean => {
    const normalized = normalizeLocation(candidate);
    return (
      normalized === 'PR1' ||
      normalized === 'PR2' ||
      normalized === 'PABELLONR1' ||
      normalized === 'PABELLONR2'
    );
  };
  return String(value ?? '')
    .split(/[/>|]/)
    .some(matchesToken);
};

export const isPavilionRecoveryEncounter = (encounter: RayenEncounter): boolean =>
  isPavilionRecoveryLocation(encounter.bed) || isPavilionRecoveryLocation(encounter.room);

export const preparePavilionRecoverySyncScope = (
  snapshot: RayenCensusSnapshot,
  current: DailyRecord,
  occupiedBedIds: ReadonlySet<string>,
  findCurrent: (encounter: RayenEncounter) => { bedId: string } | undefined
) => {
  const allActive = snapshot.encounters.filter(encounter => !isDischargedEncounter(encounter));
  const ignoredEncounters = allActive.filter(isPavilionRecoveryEncounter);
  const ignoredEpisodeIds = new Set([
    ...ignoredEncounters.map(encounter => String(encounter.encounterId ?? '').trim()),
    ...(snapshot.activeBedAssignments ?? [])
      .filter(assignment => isPavilionRecoveryLocation(assignment.bedId))
      .map(assignment => assignment.encounterId),
  ]);
  const activeEncounters = allActive.filter(
    encounter => !ignoredEpisodeIds.has(String(encounter.encounterId ?? '').trim())
  );
  const activeBedAssignments = (snapshot.activeBedAssignments ?? []).filter(
    assignment =>
      !ignoredEpisodeIds.has(assignment.encounterId) &&
      !isPavilionRecoveryLocation(assignment.bedId)
  );
  const { snapshotEpisodeIds, activeBedByEpisode } = buildActiveBedEvidence({
    ...snapshot,
    activeBedAssignments,
  });
  const ignoredLocalBedIds = new Set(
    ignoredEncounters.map(findCurrent).flatMap(match => (match ? [match.bedId] : []))
  );
  for (const bedId of occupiedBedIds) {
    const episodeId = String(current.beds[bedId]?.clinicalEpisodeId ?? '').trim();
    if (ignoredEpisodeIds.has(episodeId)) ignoredLocalBedIds.add(bedId);
  }
  return {
    activeEncounters,
    dischargedEncounters: snapshot.encounters.filter(isDischargedEncounter),
    snapshotEpisodeIds,
    activeBedByEpisode,
    ignoredLocalBedIds,
    activeClinicalEpisodeIds: [
      ...new Set([
        ...activeEncounters.map(encounter => String(encounter.encounterId ?? '').trim()),
        ...activeBedAssignments.map(assignment => assignment.encounterId),
      ]),
    ].filter(Boolean),
  };
};
