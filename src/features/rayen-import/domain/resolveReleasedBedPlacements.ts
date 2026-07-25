import type {
  AdmissionEntry,
  ConflictEntry,
  DischargeEntry,
  MoveEntry,
} from '../contracts/censusImportDiff';
import { normalizeRut } from '@/utils/rutUtils';

interface ReleasedBedPlacementResult {
  admissions: AdmissionEntry[];
  moves: MoveEntry[];
  promotedMoves: MoveEntry[];
  conflicts: ConflictEntry[];
}

interface PlacementIdentity {
  episodeId?: string;
  run?: string;
}

const identityOf = (conflict: ConflictEntry): PlacementIdentity | null => {
  if (conflict.blockedAdmission) {
    return {
      episodeId:
        conflict.blockedAdmission.source?.encounterId ??
        conflict.blockedAdmission.patient.clinicalEpisodeId,
      run: conflict.blockedAdmission.patient.rut,
    };
  }
  if (conflict.blockedMove) {
    return {
      episodeId: conflict.blockedMove.source.encounterId,
      run: conflict.blockedMove.rut,
    };
  }
  return null;
};

const hasDistinctDischargedOccupant = (
  identity: PlacementIdentity,
  discharges: DischargeEntry[]
): boolean => {
  const episode = String(identity.episodeId ?? '').trim();
  const run = normalizeRut(identity.run);
  const comparisons = discharges.map(discharge => {
    const dischargeEpisode = String(
      discharge.encounterId ?? discharge.source?.encounterId ?? ''
    ).trim();
    if (episode && dischargeEpisode) return episode === dischargeEpisode ? 'same' : 'different';
    if (episode || dischargeEpisode) return 'unknown';
    const dischargeRun = normalizeRut(discharge.rut);
    if (!run || !dischargeRun) return 'unknown';
    return run === dischargeRun ? 'same' : 'different';
  });
  return !comparisons.includes('same') && comparisons.includes('different');
};

const isPlacementPatientDischarged = (
  identity: PlacementIdentity,
  discharges: DischargeEntry[]
): boolean => {
  const episode = String(identity.episodeId ?? '').trim();
  const run = normalizeRut(identity.run);
  return discharges.some(discharge => {
    const dischargeEpisode = String(
      discharge.encounterId ?? discharge.source?.encounterId ?? ''
    ).trim();
    if (episode && dischargeEpisode) return episode === dischargeEpisode;
    if (episode || dischargeEpisode) return false;
    return Boolean(run && normalizeRut(discharge.rut) === run);
  });
};

/** Promotes one blocked admission or move when an authoritative egreso frees its exact target. */
export const resolveReleasedBedPlacements = (
  admissions: AdmissionEntry[],
  moves: MoveEntry[],
  discharges: DischargeEntry[],
  conflicts: ConflictEntry[]
): ReleasedBedPlacementResult => {
  const claimedBeds = new Set([
    ...admissions.map(entry => entry.bedId),
    ...moves.map(entry => entry.toBedId),
  ]);
  const dischargesByBed = new Map<string, DischargeEntry[]>();
  for (const discharge of discharges) {
    const current = dischargesByBed.get(discharge.bedId) ?? [];
    current.push(discharge);
    dischargesByBed.set(discharge.bedId, current);
  }
  const candidatesByBed = new Map<string, ConflictEntry[]>();
  const conflictsByBed = new Map<string, ConflictEntry[]>();
  const canceledPlacements = new Set<ConflictEntry>();
  for (const conflict of conflicts) {
    const identity = identityOf(conflict);
    if (identity && isPlacementPatientDischarged(identity, discharges)) {
      // The administrative report is authoritative: an admission/move for the same episode is no
      // longer pending placement and must not block another candidate for the released bed.
      canceledPlacements.add(conflict);
      continue;
    }
    if (conflict.bedId) {
      const bedConflicts = conflictsByBed.get(conflict.bedId) ?? [];
      bedConflicts.push(conflict);
      conflictsByBed.set(conflict.bedId, bedConflicts);
    }
    if (
      conflict.code !== 'occupied-local-bed' ||
      !conflict.bedId ||
      (!conflict.blockedAdmission && !conflict.blockedMove)
    )
      continue;
    const current = candidatesByBed.get(conflict.bedId) ?? [];
    current.push(conflict);
    candidatesByBed.set(conflict.bedId, current);
  }

  const promoted = new Set<ConflictEntry>();
  const resolvedAdmissions = [...admissions];
  const resolvedMoves = [...moves];
  const promotedMoves: MoveEntry[] = [];
  const releasedByMove = new Set(moves.map(move => move.fromBedId));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [bedId, candidates] of candidatesByBed) {
      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      if (!candidate || promoted.has(candidate)) continue;
      const identity = identityOf(candidate);
      const hasSiblingConflict = (conflictsByBed.get(bedId) ?? []).some(
        conflict => conflict !== candidate
      );
      const released =
        releasedByMove.has(bedId) ||
        Boolean(
          identity && hasDistinctDischargedOccupant(identity, dischargesByBed.get(bedId) ?? [])
        );
      if (!identity || hasSiblingConflict || claimedBeds.has(bedId) || !released) continue;
      if (candidate.blockedAdmission) {
        resolvedAdmissions.push(candidate.blockedAdmission);
      } else if (candidate.blockedMove) {
        resolvedMoves.push(candidate.blockedMove);
        promotedMoves.push(candidate.blockedMove);
        releasedByMove.add(candidate.blockedMove.fromBedId);
      } else continue;
      claimedBeds.add(bedId);
      promoted.add(candidate);
      changed = true;
    }
  }
  return {
    admissions: resolvedAdmissions,
    moves: resolvedMoves,
    promotedMoves,
    conflicts: conflicts.filter(
      conflict => !promoted.has(conflict) && !canceledPlacements.has(conflict)
    ),
  };
};
