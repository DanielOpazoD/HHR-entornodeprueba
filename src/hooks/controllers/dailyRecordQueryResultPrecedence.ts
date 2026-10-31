import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { toRecordTimestamp } from '@/services/repositories/dailyRecordConsistencyPolicy';
import { wouldReplacePendingDailyRecordIdentity } from './dailyRecordPendingPatchController';

const mustSurfaceIncomingRuntime = ({ runtime }: DailyRecordQueryResult): boolean =>
  runtime.availabilityState === 'temporarily_unavailable' ||
  runtime.consistencyState === 'unavailable' ||
  runtime.consistencyState === 'blocked' ||
  runtime.conflictSummary?.kind === 'remote_unavailable';

const retainUnconfirmedResult = (result: DailyRecordQueryResult): DailyRecordQueryResult =>
  result.runtime.serverConfirmed
    ? { ...result, runtime: { ...result.runtime, serverConfirmed: false } }
    : result;

const baseSource = ({ runtime }: DailyRecordQueryResult) =>
  runtime.baseSource ?? runtime.sourceOfTruth;

export const settleFinishedPointRead = ({
  startedWith,
  current,
  incoming,
  superseded,
}: {
  startedWith: DailyRecordQueryResult | undefined;
  current: DailyRecordQueryResult | undefined;
  incoming: DailyRecordQueryResult;
  superseded: boolean;
}): { result: DailyRecordQueryResult; confirms: boolean } => {
  if (!incoming.record && current?.record && current !== startedWith) {
    return { result: retainUnconfirmedResult(current), confirms: false };
  }
  if (
    current?.record &&
    current !== startedWith &&
    (superseded || (baseSource(current) === 'remote' && current.record !== startedWith?.record))
  ) {
    return { result: current, confirms: false };
  }
  return { result: reconcileDailyRecordQueryResult(current, incoming), confirms: !superseded };
};

/**
 * Keeps monotonic confirmed data without hiding authority, absence or availability transitions.
 * A remote result always supersedes a local optimistic projection, even when its server timestamp
 * is lower than the client's wall clock.
 */
export const reconcileDailyRecordQueryResult = (
  previous: DailyRecordQueryResult | undefined,
  incoming: DailyRecordQueryResult
): DailyRecordQueryResult => {
  if (!previous?.record) return incoming;
  const { record: previousRecord, runtime: previousRuntime } = previous;
  const { record, runtime } = incoming;
  // A late local/cache-only miss cannot erase data.
  if (runtime.availabilityState === 'unconfirmed_missing') {
    return retainUnconfirmedResult(previous);
  }
  const retainsPendingIdentity =
    record &&
    !runtime.serverConfirmed &&
    wouldReplacePendingDailyRecordIdentity(runtime.date, record, previousRecord);
  if (
    mustSurfaceIncomingRuntime(incoming) &&
    (retainsPendingIdentity ||
      !record ||
      toRecordTimestamp(previousRecord.lastUpdated) >= toRecordTimestamp(record.lastUpdated))
  ) {
    // Show the read failure without replacing the last known data or its provenance.
    return {
      ...incoming,
      record: previousRecord,
      runtime: {
        ...runtime,
        serverConfirmed: false,
        baseSource: previousRuntime.baseSource,
        sourceOfTruth: previousRuntime.sourceOfTruth,
      },
    };
  }
  if (retainsPendingIdentity) return retainUnconfirmedResult(previous);
  if (
    !record ||
    mustSurfaceIncomingRuntime(incoming) ||
    (baseSource(previous) === 'local' && baseSource(incoming) !== 'local')
  ) {
    return incoming;
  }

  const previousTimestamp = toRecordTimestamp(previousRecord.lastUpdated);
  const incomingTimestamp = toRecordTimestamp(record.lastUpdated);
  if (previousTimestamp > incomingTimestamp) {
    return retainUnconfirmedResult(previous);
  }
  if (
    previousTimestamp === incomingTimestamp &&
    baseSource(previous) === 'remote' &&
    baseSource(incoming) === 'local'
  ) {
    // The local copy matches the version on screen, so it keeps its remote provenance. A server
    // read still proves that version current; only a cached one leaves it unconfirmed.
    return runtime.serverConfirmed
      ? {
          record: previousRecord,
          runtime: {
            ...runtime,
            baseSource: 'remote',
            sourceOfTruth: previousRuntime.sourceOfTruth,
          },
        }
      : retainUnconfirmedResult(previous);
  }
  return incoming;
};
