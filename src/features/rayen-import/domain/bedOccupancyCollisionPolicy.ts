import { REGULAR_BEDS } from '@/constants/beds';
import type {
  BedOccupancyCollision,
  BedOccupancyCollisionCandidate,
  BedOccupancyCollisionResolution,
  CmaEquivalentBedId,
  CensusImportDiff,
} from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenBedCollisionResolutionReceipt } from '@/types/domain/rayenBedCollision';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import type { MappedPatient } from '../mapping/rayenToPatientData';
import { isOccupiedCensusPatient } from './censusReconciliationPredicates';

export interface ActivePrincipalPlacement {
  encounter: RayenEncounter;
  mapped: MappedPatient;
}

interface CollisionPreparationOptions {
  current: DailyRecord;
  placements: ActivePrincipalPlacement[];
  findCurrent: (encounter: RayenEncounter) => { bedId: string } | undefined;
  diff: CensusImportDiff;
  consumedBedIds: Set<string>;
}

const CMA_EQUIVALENT_BED_IDS: readonly CmaEquivalentBedId[] = [
  'R1',
  'R2',
  'R3',
  'R4',
  'NEO1',
  'NEO2',
];

/** Beds already claimed by the structural plan and unavailable as collision destinations. */
export const reservedRayenStructuralTargetBedIds = (diff: CensusImportDiff): string[] => [
  ...diff.admissions.map(entry => entry.bedId),
  ...diff.moves.map(entry => entry.toBedId),
  ...(diff.bedOccupancyCollisions ?? []).map(collision => collision.bedId),
];

const collisionId = (bedId: string, candidates: BedOccupancyCollisionCandidate[]): string =>
  `${bedId}:${candidates
    .map(candidate => candidate.clinicalEpisodeId)
    .sort()
    .join(':')}`;

/**
 * Extracts only the exceptional alias collisions where Rayen reports a CMA virtual location and
 * its equivalent physical HHR bed as simultaneously occupied. Ordinary same-bed collisions keep
 * the existing conservative policy.
 */
export const extractEquivalentBedSourceCollisions = (
  current: DailyRecord,
  placements: ActivePrincipalPlacement[],
  findCurrent: (encounter: RayenEncounter) => { bedId: string } | undefined
): {
  remaining: ActivePrincipalPlacement[];
  collisions: BedOccupancyCollision[];
  retainedResolutions: RayenBedCollisionResolutionReceipt[];
} => {
  const collisions: BedOccupancyCollision[] = [];
  const retainedResolutions: RayenBedCollisionResolutionReceipt[] = [];
  const consumedEpisodes = new Set<string>();
  const resolvedPlacements: ActivePrincipalPlacement[] = [];

  for (const bedId of CMA_EQUIVALENT_BED_IDS) {
    const equivalentPlacements = placements.filter(
      item => item.mapped.bedId === bedId && !consumedEpisodes.has(item.encounter.encounterId)
    );
    if (
      equivalentPlacements.length !== 2 ||
      equivalentPlacements[0].mapped.isCma === equivalentPlacements[1].mapped.isCma
    ) {
      continue;
    }

    if (
      equivalentPlacements[0].encounter.encounterId ===
      equivalentPlacements[1].encounter.encounterId
    ) {
      consumedEpisodes.add(equivalentPlacements[0].encounter.encounterId);
      resolvedPlacements.push(
        equivalentPlacements.find(item => !item.mapped.isCma) ?? equivalentPlacements[0]
      );
      continue;
    }

    const candidates = equivalentPlacements.map(
      ({ encounter, mapped }): BedOccupancyCollisionCandidate => ({
        clinicalEpisodeId: encounter.encounterId,
        sourceKind: mapped.isCma ? 'cma' : 'medical-surgical',
        patient: mapped.patient,
        source: encounter,
        currentBedId: findCurrent(encounter)?.bedId,
      })
    ) as [BedOccupancyCollisionCandidate, BedOccupancyCollisionCandidate];
    const id = collisionId(bedId, candidates);
    const receipt = current.rayenBedCollisionResolutions?.find(item => item.id === id);
    const selected = receipt
      ? equivalentPlacements.find(item => item.encounter.encounterId === receipt.selectedEpisodeId)
      : undefined;
    const other = receipt
      ? equivalentPlacements.find(item => item.encounter.encounterId === receipt.otherEpisodeId)
      : undefined;
    const selectedCurrent = selected ? findCurrent(selected.encounter) : undefined;
    const otherCurrent = other ? findCurrent(other.encounter) : undefined;
    const otherOutcomeStillMatches =
      receipt?.otherDisposition.kind === 'move'
        ? otherCurrent?.bedId === receipt.otherDisposition.targetBedId
        : receipt?.otherDisposition.kind === 'discharge'
          ? !otherCurrent &&
            current.discharges.some(
              item => !item.deletedAt && item.clinicalEpisodeId === receipt.otherEpisodeId
            )
          : receipt?.otherDisposition.kind === 'transfer'
            ? !otherCurrent &&
              current.transfers.some(
                item => !item.deletedAt && item.clinicalEpisodeId === receipt.otherEpisodeId
              )
            : receipt?.otherDisposition.kind === 'remove'
              ? !otherCurrent
              : false;
    if (
      receipt &&
      selected &&
      other &&
      selectedCurrent?.bedId === bedId &&
      otherOutcomeStillMatches
    ) {
      candidates.forEach(candidate => consumedEpisodes.add(candidate.clinicalEpisodeId));
      retainedResolutions.push(receipt);
      resolvedPlacements.push(selected);
      if (receipt.otherDisposition.kind === 'move') {
        resolvedPlacements.push({
          encounter: other.encounter,
          mapped: {
            ...other.mapped,
            bedId: receipt.otherDisposition.targetBedId,
            patient: {
              ...other.mapped.patient,
              bedId: receipt.otherDisposition.targetBedId,
            },
          },
        });
      }
      continue;
    }
    const candidateEpisodes = new Set(candidates.map(candidate => candidate.clinicalEpisodeId));
    const candidateCurrentBedIds = new Set(
      candidates.map(candidate => candidate.currentBedId).filter(Boolean)
    );
    const availableAlternativeBedIds = REGULAR_BEDS.filter(bed => bed.id !== bedId)
      .filter(bed => {
        const occupant = current.beds[bed.id];
        if (occupant?.isBlocked) return false;
        return (
          !isOccupiedCensusPatient(occupant) ||
          candidateEpisodes.has(occupant.clinicalEpisodeId?.trim() ?? '') ||
          candidateCurrentBedIds.has(bed.id)
        );
      })
      .map(bed => bed.id);

    candidates.forEach(candidate => consumedEpisodes.add(candidate.clinicalEpisodeId));
    collisions.push({
      id,
      bedId,
      candidates,
      availableAlternativeBedIds,
    });
  }

  return {
    remaining: [
      ...placements.filter(item => !consumedEpisodes.has(item.encounter.encounterId)),
      ...resolvedPlacements,
    ],
    collisions,
    retainedResolutions,
  };
};

export const prepareEquivalentBedSourceCollisions = ({
  current,
  placements,
  findCurrent,
  diff,
  consumedBedIds,
}: CollisionPreparationOptions): ActivePrincipalPlacement[] => {
  const prepared = extractEquivalentBedSourceCollisions(current, placements, findCurrent);
  diff.bedOccupancyCollisions = prepared.collisions;
  diff.retainedBedCollisionResolutions = prepared.retainedResolutions;
  for (const collision of prepared.collisions) {
    for (const candidate of collision.candidates) {
      if (candidate.currentBedId) consumedBedIds.add(candidate.currentBedId);
    }
    diff.conflicts.push({
      bedId: collision.bedId,
      patientName: collision.candidates.map(candidate => candidate.patient.patientName).join(' / '),
      code: 'cma-physical-bed-collision',
      reason: `CMA ${collision.bedId} y ${collision.bedId} médico-quirúrgica aparecen ocupadas simultáneamente. Selecciona quién conservará ${collision.bedId} y qué ocurrirá con la otra persona.`,
      source: collision.candidates[0].source,
    });
  }
  return prepared.remaining;
};

export const resolveBedOccupancyCollisions = (
  diff: CensusImportDiff,
  resolutions: BedOccupancyCollisionResolution[]
): CensusImportDiff => {
  const collisions = diff.bedOccupancyCollisions ?? [];
  if (collisions.length === 0) return diff;

  const accepted: BedOccupancyCollisionResolution[] = [];
  const resolvedIds = new Set<string>();
  for (const collision of collisions) {
    const resolution = resolutions.find(item => item.collisionId === collision.id);
    if (!resolution) continue;
    if (
      !collision.candidates.some(
        candidate => candidate.clinicalEpisodeId === resolution.selectedEpisodeId
      )
    ) {
      continue;
    }
    if (
      resolution.otherDisposition.kind === 'move' &&
      !collision.availableAlternativeBedIds.includes(resolution.otherDisposition.targetBedId)
    ) {
      continue;
    }
    accepted.push(resolution);
    resolvedIds.add(collision.id);
  }

  const plannedTargets = new Set(reservedRayenStructuralTargetBedIds(diff));
  const moveTargets = accepted.flatMap(resolution =>
    resolution.otherDisposition.kind === 'move' ? [resolution.otherDisposition.targetBedId] : []
  );
  const hasReservedTarget = moveTargets.some(targetBedId => plannedTargets.has(targetBedId));
  const hasDuplicateTarget = new Set(moveTargets).size !== moveTargets.length;
  if (hasReservedTarget || hasDuplicateTarget) {
    return {
      ...diff,
      bedOccupancyCollisionResolutions: [],
      summary: { ...diff.summary, conflicts: diff.conflicts.length },
    };
  }

  const conflicts = diff.conflicts.filter(
    conflict =>
      conflict.code !== 'cma-physical-bed-collision' ||
      !conflict.source?.encounterId ||
      !collisions.some(
        collision =>
          resolvedIds.has(collision.id) &&
          collision.candidates.some(
            candidate => candidate.clinicalEpisodeId === conflict.source?.encounterId
          )
      )
  );
  return {
    ...diff,
    conflicts,
    bedOccupancyCollisionResolutions: accepted,
    summary: { ...diff.summary, conflicts: conflicts.length },
  };
};
