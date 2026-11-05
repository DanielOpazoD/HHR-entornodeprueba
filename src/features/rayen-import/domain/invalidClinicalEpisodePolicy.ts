import type {
  AdmissionEntry,
  CensusImportDiff,
  ConflictEntry,
  DischargeEntry,
} from '../contracts/censusImportDiff';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';

/**
 * «Paciente no válido»: Eloísa episodes that a census editor removed because the software created
 * them by mistake, for example a second admission of a patient already in another bed. Eloísa
 * cannot delete them, so they live on there until their epicrisis and egreso.
 *
 * The mark is keyed by episode, never by RUN: a real readmission (even on the same day) is a new
 * episode and syncs normally. A marked episode is never admitted, moved, updated, discharged or
 * reported again, so it never counts in the census statistics.
 */
export type InvalidClinicalEpisodeIds = ReadonlySet<string>;

export const isInvalidClinicalEpisode = (
  invalidEpisodeIds: InvalidClinicalEpisodeIds,
  episodeId: unknown
): boolean => {
  const key = String(episodeId ?? '').trim();
  return key !== '' && invalidEpisodeIds.has(key);
};

/** Removes marked episodes from the Ficha Médico and Gestión de Camas capture. */
export const excludeInvalidEpisodesFromSnapshot = (
  snapshot: RayenCensusSnapshot,
  invalidEpisodeIds: InvalidClinicalEpisodeIds
): RayenCensusSnapshot => {
  if (invalidEpisodeIds.size === 0) return snapshot;
  return {
    ...snapshot,
    encounters: snapshot.encounters.filter(
      encounter => !isInvalidClinicalEpisode(invalidEpisodeIds, encounter.encounterId)
    ),
    ...(snapshot.activeBedAssignments
      ? {
          activeBedAssignments: snapshot.activeBedAssignments.filter(
            assignment => !isInvalidClinicalEpisode(invalidEpisodeIds, assignment.encounterId)
          ),
        }
      : {}),
  };
};

/** Removes report rows (or candidates) already tied to a marked episode. */
export const excludeInvalidEpisodeRows = <Row extends { encounterId?: string }>(
  rows: readonly Row[],
  invalidEpisodeIds: InvalidClinicalEpisodeIds
): Row[] => rows.filter(row => !isInvalidClinicalEpisode(invalidEpisodeIds, row.encounterId));

const admissionEpisodes = (entry: AdmissionEntry): unknown[] => [
  entry.patient.clinicalEpisodeId,
  entry.source?.encounterId,
];

const dischargeEpisodes = (entry: DischargeEntry): unknown[] => [
  entry.encounterId,
  entry.expectedOccupant?.clinicalEpisodeId,
  entry.source?.encounterId,
];

const conflictEpisodes = (entry: ConflictEntry): unknown[] => [
  entry.clinicalEpisodeId,
  entry.source?.encounterId,
  ...(entry.blockedAdmission ? admissionEpisodes(entry.blockedAdmission) : []),
  entry.blockedMove?.source.encounterId,
];

/**
 * Last line of defence after planning: local records and Eloísa lookups can still name a marked
 * episode (a previous day that kept it, a report row enriched with its episode). None of those
 * entries may reach the census.
 */
export const scrubInvalidEpisodesFromDiff = (
  diff: CensusImportDiff,
  invalidEpisodeIds: InvalidClinicalEpisodeIds
): CensusImportDiff => {
  if (invalidEpisodeIds.size === 0) return diff;
  const keeps = (episodes: unknown[]): boolean =>
    !episodes.some(episodeId => isInvalidClinicalEpisode(invalidEpisodeIds, episodeId));
  return {
    ...diff,
    admissions: diff.admissions.filter(entry => keeps(admissionEpisodes(entry))),
    updates: diff.updates.filter(entry =>
      keeps([entry.patient.clinicalEpisodeId, entry.source?.encounterId])
    ),
    moves: diff.moves.filter(entry => keeps([entry.source.encounterId])),
    discharges: diff.discharges.filter(entry => keeps(dischargeEpisodes(entry))),
    pendingAdministrativeDischarges: diff.pendingAdministrativeDischarges.filter(entry =>
      keeps([entry.encounterId, entry.source?.encounterId])
    ),
    conflicts: diff.conflicts.filter(entry => keeps(conflictEpisodes(entry))),
    ...(diff.reportEgresos
      ? { reportEgresos: excludeInvalidEpisodeRows(diff.reportEgresos, invalidEpisodeIds) }
      : {}),
    ...(diff.previousDayAdmissionCandidates
      ? {
          previousDayAdmissionCandidates: diff.previousDayAdmissionCandidates.filter(entry =>
            keeps(admissionEpisodes(entry))
          ),
        }
      : {}),
    ...(diff.activeClinicalEpisodeIds
      ? {
          activeClinicalEpisodeIds: diff.activeClinicalEpisodeIds.filter(
            episodeId => !isInvalidClinicalEpisode(invalidEpisodeIds, episodeId)
          ),
        }
      : {}),
  };
};
