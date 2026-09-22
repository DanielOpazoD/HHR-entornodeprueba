import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { toRecordTimestamp } from '@/services/repositories/dailyRecordConsistencyPolicy';

const mustSurfaceIncomingRuntime = (incoming: DailyRecordQueryResult): boolean =>
  incoming.runtime.availabilityState === 'temporarily_unavailable' ||
  incoming.runtime.consistencyState === 'unavailable' ||
  incoming.runtime.conflictSummary?.kind === 'remote_unavailable';

/**
 * Keeps monotonic confirmed data without hiding authority, absence or availability transitions.
 * A remote result always supersedes a local optimistic projection, even when its server timestamp
 * is lower than the client's wall clock.
 */
export const reconcileDailyRecordQueryResult = (
  previous: DailyRecordQueryResult | undefined,
  incoming: DailyRecordQueryResult
): DailyRecordQueryResult => {
  if (
    previous?.record &&
    mustSurfaceIncomingRuntime(incoming) &&
    (!incoming.record ||
      toRecordTimestamp(previous.record.lastUpdated) >=
        toRecordTimestamp(incoming.record.lastUpdated))
  ) {
    // Show the read failure without replacing the last known data or its provenance.
    return {
      ...incoming,
      record: previous.record,
      runtime: { ...incoming.runtime, sourceOfTruth: previous.runtime.sourceOfTruth },
    };
  }
  if (
    !previous?.record ||
    !incoming.record ||
    mustSurfaceIncomingRuntime(incoming) ||
    (previous.runtime.sourceOfTruth === 'local' && incoming.runtime.sourceOfTruth !== 'local')
  ) {
    return incoming;
  }

  const previousTimestamp = toRecordTimestamp(previous.record.lastUpdated);
  const incomingTimestamp = toRecordTimestamp(incoming.record.lastUpdated);
  if (previousTimestamp > incomingTimestamp) {
    return previous;
  }
  if (
    previousTimestamp === incomingTimestamp &&
    previous.runtime.sourceOfTruth === 'remote' &&
    incoming.runtime.sourceOfTruth === 'local'
  ) {
    return previous;
  }
  return incoming;
};
