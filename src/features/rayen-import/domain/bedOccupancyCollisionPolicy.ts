import type {
  BedOccupancyCollision,
  BedOccupancyCollisionResolution,
  CensusImportDiff,
  ConflictEntry,
} from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenBedCollisionResolutionReceipt } from '@/types/domain/rayenBedCollision';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import type { MappedPatient } from '../mapping/rayenToPatientData';

export interface ActivePrincipalPlacement {
  encounter: RayenEncounter;
  mapped: MappedPatient;
}

interface CollisionPreparationOptions {
  current: DailyRecord;
  placements: ActivePrincipalPlacement[];
  findCurrent: (encounter: RayenEncounter) => { bedId: string } | undefined;
  diff: CensusImportDiff;
}

/** Beds already claimed by the structural plan and unavailable as collision destinations. */
export const reservedRayenStructuralTargetBedIds = (diff: CensusImportDiff): string[] => [
  ...diff.admissions.map(entry => entry.bedId),
  ...diff.moves.map(entry => entry.toBedId),
  ...(diff.bedOccupancyCollisions ?? []).map(collision => collision.bedId),
];

/** Conflicting destinations of one episode are not two patients or evidence of a move. */
const uniqueEpisodePlacements = (
  placements: ActivePrincipalPlacement[]
): {
  remaining: ActivePrincipalPlacement[];
  conflicts: ConflictEntry[];
} => {
  const byEpisode = new Map<string, ActivePrincipalPlacement[]>();
  for (const item of placements) {
    const id = item.encounter.encounterId;
    byEpisode.set(id, [...(byEpisode.get(id) ?? []), item]);
  }
  const remaining: ActivePrincipalPlacement[] = [];
  const conflicts: ConflictEntry[] = [];
  for (const aliases of byEpisode.values()) {
    const medical = aliases.filter(item => !item.mapped.isCma);
    const candidates =
      medical.length &&
      aliases.every(item => item.mapped.bedId?.replace(/^CMA_/, '') === medical[0].mapped.bedId)
        ? medical
        : aliases;
    const destinations = new Set(candidates.map(item => item.mapped.bedId));
    if (destinations.size === 1) {
      remaining.push(candidates[0]);
      continue;
    }
    const first = aliases[0];
    conflicts.push({
      bedId: null,
      patientName: first.mapped.patient.patientName,
      source: first.encounter,
      code: 'principal-bed-collision',
      reason:
        'Eloísa informa ubicaciones distintas para el mismo episodio; confirma su ubicación antes de sincronizarlo.',
    });
  }
  return { remaining, conflicts };
};

/** Keeps source assignments distinct and preserves the audit guard of older manual choices. */
export const extractEquivalentBedSourceCollisions = (
  current: DailyRecord,
  placements: ActivePrincipalPlacement[],
  findCurrent: (encounter: RayenEncounter) => { bedId: string } | undefined
): {
  remaining: ActivePrincipalPlacement[];
  collisions: BedOccupancyCollision[];
  retainedResolutions: RayenBedCollisionResolutionReceipt[];
  conflicts: ConflictEntry[];
} => {
  const unique = uniqueEpisodePlacements(placements);
  placements = unique.remaining;
  const retainedResolutions: RayenBedCollisionResolutionReceipt[] = [];
  // Keep the stale-discharge protection of an earlier manual decision while its exact
  // selected episode is still active. Its former forced bed/removal is not replayed.
  for (const receipt of current.rayenBedCollisionResolutions ?? []) {
    const selected = placements.find(
      item => item.encounter.encounterId === receipt.selectedEpisodeId
    );
    const other = placements.find(item => item.encounter.encounterId === receipt.otherEpisodeId);
    if (
      selected &&
      other &&
      findCurrent(selected.encounter) &&
      selected.mapped.bedId !== other.mapped.bedId &&
      selected.mapped.bedId?.replace(/^CMA_/, '') === other.mapped.bedId?.replace(/^CMA_/, '')
    ) {
      retainedResolutions.push(receipt);
    }
  }
  return {
    remaining: placements,
    collisions: [],
    retainedResolutions,
    conflicts: unique.conflicts,
  };
};

export const prepareEquivalentBedSourceCollisions = ({
  current,
  placements,
  findCurrent,
  diff,
}: CollisionPreparationOptions): ActivePrincipalPlacement[] => {
  const prepared = extractEquivalentBedSourceCollisions(current, placements, findCurrent);
  diff.conflicts.push(...prepared.conflicts);
  diff.bedOccupancyCollisions = prepared.collisions;
  diff.retainedBedCollisionResolutions = prepared.retainedResolutions;
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
