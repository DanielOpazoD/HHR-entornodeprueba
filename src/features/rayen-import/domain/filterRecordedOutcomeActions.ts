import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { extractTime } from '../mapping/rayenToPatientData';
import { createRecordedOutcomeMatcher } from './censusDischargeHistory';

/**
 * Removes stale Rayen actions for episodes already concluded in HHR by alta, traslado or CMA.
 * This is evaluated immediately before apply so a manual action made during review remains final.
 */
export const filterRecordedOutcomeActions = (
  current: DailyRecord,
  diff: CensusImportDiff
): CensusImportDiff => {
  const hasRecordedOutcome = createRecordedOutcomeMatcher(current);
  const operationWasResolved = (operation: {
    patient?: {
      clinicalEpisodeId?: string;
      rut?: string;
      admissionDate?: string;
      admissionTime?: string;
    };
    source?: { encounterId: string; run?: string };
    rut?: string;
  }): boolean =>
    hasRecordedOutcome({
      clinicalEpisodeId: operation.patient?.clinicalEpisodeId || operation.source?.encounterId,
      rut: operation.patient?.rut || operation.rut || operation.source?.run,
      admissionDay: operation.patient?.admissionDate,
      admissionTime: operation.patient?.admissionTime,
    });
  const activeCollisions = (diff.bedOccupancyCollisions ?? []).filter(collision =>
    collision.candidates.some(candidate => !operationWasResolved(candidate))
  );
  const activeCollisionIds = new Set(activeCollisions.map(collision => collision.id));
  const automaticallyResolvedCollisions = activeCollisions.flatMap(collision => {
    const activeCandidates = collision.candidates.filter(
      candidate => !operationWasResolved(candidate)
    );
    if (activeCandidates.length !== 1) return [];
    return [
      {
        collisionId: collision.id,
        selectedEpisodeId: activeCandidates[0].clinicalEpisodeId,
        // The other episode already has its manually recorded outcome. Removing only its stale
        // bed representation avoids duplicating that alta, traslado or CMA movement.
        otherDisposition: { kind: 'remove' as const },
      },
    ];
  });
  const automaticallyResolvedIds = new Set(
    automaticallyResolvedCollisions.map(resolution => resolution.collisionId)
  );

  return {
    ...diff,
    admissions: diff.admissions.filter(entry => !operationWasResolved(entry)),
    updates: diff.updates.filter(entry => !operationWasResolved(entry)),
    moves: diff.moves.filter(entry => !operationWasResolved(entry)),
    discharges: diff.discharges.filter(
      entry =>
        !hasRecordedOutcome({
          clinicalEpisodeId:
            entry.encounterId ??
            entry.source?.encounterId ??
            entry.expectedOccupant?.clinicalEpisodeId,
          rut: entry.rut || entry.source?.run,
          admissionDay:
            entry.expectedOccupant?.admissionDate ?? entry.source?.admissionDatetime?.slice(0, 10),
          admissionTime:
            entry.expectedOccupant?.admissionTime ?? extractTime(entry.source?.admissionDatetime),
        })
    ),
    reportEgresos: diff.reportEgresos?.filter(
      entry =>
        !hasRecordedOutcome({
          clinicalEpisodeId: entry.encounterId,
          rut: entry.run,
          admissionDay: entry.admissionDay,
          admissionTime: entry.admissionTime,
        })
    ),
    bedOccupancyCollisions: activeCollisions,
    bedOccupancyCollisionResolutions: [
      ...(diff.bedOccupancyCollisionResolutions ?? []).filter(
        resolution =>
          activeCollisionIds.has(resolution.collisionId) &&
          !automaticallyResolvedIds.has(resolution.collisionId)
      ),
      ...automaticallyResolvedCollisions,
    ],
  };
};
