import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A write's state and that state's detail (`cause`, `reason` or `localCopy`). */
type WriteOutcome = DistributiveOmit<
  DailyRecordWriteResult,
  | 'date'
  | 'savedHere'
  | 'userSafeMessage'
  | 'blockingError'
  | 'concurrencyConflict'
  | 'confirmedRecord'
  | 'localProjectionRecord'
>;

/** Why the write ended where it did, as its caller is told. */
interface WriteDecision {
  userSafeMessage?: string;
  blockingError?: Error;
  /** Another writer changed the day first. */
  concurrencyConflict?: boolean;
}

/**
 * The repository's write so far, and whether the caller's workflow goes on after it (`return`:
 * the write stopped and the caller only reports it).
 */
export interface RemoteWriteStep {
  result: DailyRecordWriteResult;
  next: 'continue' | 'return';
}

/** Nothing stored yet: the result every write starts from. */
export const startWriteResult = (date: string): DailyRecordWriteResult => ({
  date,
  savedHere: false,
  state: 'local',
  cause: 'stored',
});

/**
 * The same write in a new state. With a decision, its message, error and conflict mark replace
 * the current ones; without one, they stay.
 */
export const settleWriteResult = (
  current: DailyRecordWriteResult,
  outcome: WriteOutcome,
  decision?: WriteDecision
): DailyRecordWriteResult => {
  const said = decision ?? current;
  return {
    date: current.date,
    savedHere: current.savedHere,
    ...outcome,
    ...(said.concurrencyConflict ? { concurrencyConflict: true as const } : {}),
    userSafeMessage: said.userSafeMessage,
    blockingError: said.blockingError,
    confirmedRecord: current.confirmedRecord,
    localProjectionRecord: current.localProjectionRecord,
  };
};

/**
 * A write the queue keeps sending by itself. One the server already took stays confirmed.
 */
export const pendingWriteOutcome = (
  current: DailyRecordWriteResult,
  cause: 'retrying' | 'merged'
): WriteOutcome =>
  current.state === 'confirmed'
    ? { state: 'confirmed', localCopy: 'current' }
    : { state: 'local', cause };

/**
 * A write no automatic path can finish: held here for review, or not saved when no copy stayed.
 * One the server already took stays confirmed, with this computer's copy behind it.
 */
export const unrecoverableWriteOutcome = (current: DailyRecordWriteResult): WriteOutcome => {
  if (current.state === 'confirmed') return { state: 'confirmed', localCopy: 'stale' };
  return current.savedHere
    ? { state: 'held', reason: 'needs_review' }
    : { state: 'not_saved', reason: 'local_failed' };
};

/** The authoring session ended before the write finished: held for its author when stored here. */
export const sessionEndedWriteOutcome = (current: DailyRecordWriteResult): WriteOutcome =>
  current.savedHere
    ? { state: 'held', reason: 'session_changed' }
    : { state: 'not_saved', reason: 'session_changed' };

/** A write stopped before anything was stored: not on this computer nor on the server. */
export const buildBlockedWriteResult = (
  date: string,
  userSafeMessage: string,
  blockingError?: Error
): DailyRecordWriteResult => ({
  date,
  savedHere: false,
  state: 'not_saved',
  reason: 'blocked',
  userSafeMessage,
  blockingError,
});
