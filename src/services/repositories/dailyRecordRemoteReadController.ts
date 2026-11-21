import { admitRemoteDailyRecords } from './dailyRecordLocalCachePersistence';
import {
  captureLocalRecordBase,
  inspectLocalRecordAdmission,
  type LocalRecordBase,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionEpoch } from '@/services/storage/sessionStorageTransition';
import {
  createLocalRuntimeReadCandidate,
  createLocalRuntimeReadResult,
  createNotFoundDailyRecordReadResult,
  createSupersededReadResult,
  type LocalRuntimeReadCandidate,
} from './dailyRecordReadResultController';
import {
  createDailyRecordReadResult,
  createUnavailableDailyRecordReadResult,
  type DailyRecordReadResult,
} from './contracts/dailyRecordQueries';
import type { DailyRecordRemoteLoadResult } from './dailyRecordRemoteLoader';
import { arePatchValuesDeepEqual } from '@/utils/patchValueEquality';

interface ResolveRemoteGoldenPathReadResultInput {
  date: string;
  remoteReadResult: DailyRecordRemoteLoadResult;
  base?: LocalRecordBase;
  isCurrent?: () => boolean;
}
/**
 * What the server answered for one day, admitted against this computer's copy. The only resolver
 * of a server observation: the point read and the listener both pass through it, so this computer
 * keeps the server's day exactly as the server has it (migrated only), whichever channel brought
 * it. A copy prepared here would differ from the server and give the next edit a base the server
 * never had (SAVE-02); writes prepare the day themselves.
 */
export const resolveRemoteGoldenPathReadResult = async ({
  date,
  remoteReadResult: remote,
  base = remote.issuedAgainst,
  isCurrent,
}: ResolveRemoteGoldenPathReadResultInput): Promise<DailyRecordReadResult> => {
  const candidate = remote.record;
  const decision =
    candidate && !remote.hasPendingWrites
      ? (
          await admitRemoteDailyRecords([
            {
              record: candidate,
              remoteRecord: remote.serverConfirmed ? remote.record : null,
              serverConfirmed: remote.serverConfirmed,
              expectedBase: base,
              isCurrent,
            },
          ])
        )[0]
      : undefined;
  const inspected = decision
    ? undefined
    : await inspectLocalRecordAdmission(date, base ?? { kind: 'unknown' }, null);
  const record = decision
    ? decision.record
    : inspected?.status === 'superseded'
      ? inspected.stored
      : (inspected?.record ?? null);
  if (
    decision?.status === 'superseded' ||
    inspected?.status === 'superseded' ||
    (isCurrent && !isCurrent())
  )
    return createSupersededReadResult(date, record, null);
  const retained = decision?.status === 'retained_pending';
  if (
    record &&
    (retained ||
      !remote.record ||
      !remote.serverConfirmed ||
      !arePatchValuesDeepEqual(record, candidate))
  ) {
    return createLocalRuntimeReadResult(
      date,
      { ...createLocalRuntimeReadCandidate(date, record), record },
      'indexeddb',
      {
        // A day kept under pending writes is confirmed only when it is the server's day with them.
        serverConfirmed:
          remote.serverConfirmed &&
          (!retained || decision?.status !== 'retained_pending' || decision.serverComposed),
        consistencyState: 'local_authoritative',
        retryability: 'automatic_retry',
        recoveryAction: 'defer_remote_sync',
        // The server confirmed it has no such day: this copy is not the server's day (SAVE-01).
        ...(remote.serverConfirmed && !remote.record
          ? {
              conflictSummary: { kind: 'remote_missing' as const, sourceOfTruth: 'local' as const },
            }
          : {}),
      }
    );
  }
  if (record)
    return createDailyRecordReadResult(date, record, remote.source, {
      serverConfirmed: remote.serverConfirmed,
      compatibilityTier: remote.compatibilityTier,
      compatibilityIntensity: remote.compatibilityIntensity,
      migrationRulesApplied: remote.migrationRulesApplied,
      consistencyState: 'remote_authoritative',
      sourceOfTruth: 'remote',
    });
  if (!remote.serverConfirmed) return createUnavailableDailyRecordReadResult(date);
  return { ...createNotFoundDailyRecordReadResult(date, 'missing'), serverConfirmed: true };
};
export const attemptRemoteGoldenPathRead = async ({
  date,
  localCandidate,
  loadRemoteRecordWithFallback,
  base,
  onRemoteFetchFailure,
}: {
  date: string;
  localCandidate: LocalRuntimeReadCandidate | null;
  base?: LocalRecordBase;
  loadRemoteRecordWithFallback: (
    date: string,
    options?: { base?: LocalRecordBase }
  ) => Promise<DailyRecordRemoteLoadResult>;
  onRemoteFetchFailure?: (error: unknown, date: string) => void;
}): Promise<DailyRecordReadResult> => {
  const owner = getStoredSessionOwnerKey();
  const epoch = getSessionEpoch();
  const isCurrent = () => owner === getStoredSessionOwnerKey() && epoch === getSessionEpoch();
  base ??= await captureLocalRecordBase(date);
  let remote: DailyRecordRemoteLoadResult;
  try {
    remote = await loadRemoteRecordWithFallback(date, { base });
  } catch (error) {
    onRemoteFetchFailure?.(error, date);
    if (localCandidate)
      return createLocalRuntimeReadResult(date, localCandidate, 'indexeddb', {
        consistencyState: 'local_authoritative',
        retryability: 'automatic_retry',
        recoveryAction: 'defer_remote_sync',
      });
    throw error;
  }
  return resolveRemoteGoldenPathReadResult({
    date,
    remoteReadResult: remote,
    base: remote.issuedAgainst ?? base,
    isCurrent,
  });
};
