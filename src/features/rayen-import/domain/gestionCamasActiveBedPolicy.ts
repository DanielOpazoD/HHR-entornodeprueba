import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { RayenCensusSnapshot, RayenEncounter } from '../contracts/rayenSnapshot';
import { mapRayenBed } from '../mapping/bedMapping';
import { blockedPrincipalMoveConflict } from './principalBedMovePlan';
import { isOccupiedCensusPatient as isOccupied } from './censusReconciliationPredicates';

export const buildActiveBedEvidence = (snapshot: RayenCensusSnapshot) => {
  const snapshotEpisodeIds = new Set(
    snapshot.encounters.map(encounter => String(encounter.encounterId ?? '').trim()).filter(Boolean)
  );
  const activeBedByEpisode = new Map(
    (snapshot.activeBedAssignments ?? []).map(assignment => [
      assignment.encounterId,
      assignment.bedId,
    ])
  );
  return { snapshotEpisodeIds, activeBedByEpisode };
};

export const appendActiveBedPlacementIntents = (
  current: DailyRecord,
  snapshotEpisodeIds: ReadonlySet<string>,
  activeBedByEpisode: ReadonlyMap<string, string>,
  intents: Array<{ sourceBedId?: string; targetBedId: string }>
): void => {
  for (const [sourceBedId, patient] of Object.entries(current.beds)) {
    const episodeId = patient.clinicalEpisodeId?.trim();
    if (!isOccupied(patient) || !episodeId || snapshotEpisodeIds.has(episodeId)) continue;
    const assignedBed = activeBedByEpisode.get(episodeId);
    const targetBedId = assignedBed ? mapRayenBed({ bed: assignedBed }).bedId : null;
    if (targetBedId) intents.push({ sourceBedId, targetBedId });
  }
};

interface ReconcileActiveBedAssignmentsOptions {
  current: DailyRecord;
  snapshotEpisodeIds: ReadonlySet<string>;
  activeBedByEpisode: ReadonlyMap<string, string>;
  consumedBedIds: Set<string>;
  confirmedPrincipalBedIds: Set<string>;
  feasibleMoveSourceBedIds: ReadonlySet<string>;
  diff: CensusImportDiff;
  claimTarget: (bedId: string, patientName: string, source: RayenEncounter) => boolean;
}

/**
 * Reconciles episodes omitted by Ficha Médico against active Gestión de Camas occupancy.
 * Identity is established exclusively by clinicalEpisodeId; names and bed labels never join records.
 */
export const reconcileActiveBedAssignments = ({
  current,
  snapshotEpisodeIds,
  activeBedByEpisode,
  consumedBedIds,
  confirmedPrincipalBedIds,
  feasibleMoveSourceBedIds,
  diff,
  claimTarget,
}: ReconcileActiveBedAssignmentsOptions): void => {
  for (const [sourceBedId, patient] of Object.entries(current.beds)) {
    if (consumedBedIds.has(sourceBedId) || !isOccupied(patient)) continue;
    const episodeId = patient.clinicalEpisodeId?.trim();
    if (!episodeId || snapshotEpisodeIds.has(episodeId)) continue;
    const assignedBed = activeBedByEpisode.get(episodeId);
    const targetBedId = assignedBed ? mapRayenBed({ bed: assignedBed }).bedId : null;
    if (!targetBedId) continue;

    const source: RayenEncounter = {
      encounterId: episodeId,
      run: patient.rut,
      firstGivenName: patient.firstName || patient.patientName,
      firstFamilyName: patient.lastName || '',
      room: targetBedId,
      bed: targetBedId,
    };
    consumedBedIds.add(sourceBedId);
    if (!claimTarget(targetBedId, patient.patientName, source)) continue;
    if (sourceBedId === targetBedId) {
      confirmedPrincipalBedIds.add(targetBedId);
      diff.unchangedCount += 1;
      continue;
    }
    if (!feasibleMoveSourceBedIds.has(sourceBedId)) {
      diff.conflicts.push(
        blockedPrincipalMoveConflict(current, sourceBedId, targetBedId, patient, source)
      );
      continue;
    }
    diff.moves.push({
      fromBedId: sourceBedId,
      toBedId: targetBedId,
      rut: patient.rut,
      patientName: patient.patientName,
      source,
    });
    confirmedPrincipalBedIds.add(targetBedId);
  }
};
