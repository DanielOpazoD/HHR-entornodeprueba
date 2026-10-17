declare const dailyRecordWriteLeaseBrand: unique symbol;

/** Opaque proof that the caller owns the in-tab write slot for one census date. */
export interface DailyRecordWriteLease {
  readonly [dailyRecordWriteLeaseBrand]: true;
}

const tailsByDate = new Map<string, Promise<void>>();
const activeLeaseDates = new WeakMap<object, string>();

export type DailyRecordWriteKind = 'ordinary' | 'clinical_sync' | 'structural_sync';
export interface DailyRecordWriteState {
  /** All outstanding turns, including the active write. */
  readonly pendingCount: number;
  readonly activeKind: DailyRecordWriteKind | null;
}
const idleState: DailyRecordWriteState = Object.freeze({ pendingCount: 0, activeKind: null });
const statesByDate = new Map<string, DailyRecordWriteState>();
const listenersByDate = new Map<string, Set<() => void>>();

export const getDailyRecordWriteState = (date: string): DailyRecordWriteState =>
  statesByDate.get(date) ?? idleState;

export const subscribeDailyRecordWriteState = (
  date: string,
  listener: () => void
): (() => void) => {
  const listeners = listenersByDate.get(date) ?? new Set<() => void>();
  listeners.add(listener);
  listenersByDate.set(date, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByDate.delete(date);
  };
};

const publishState = (date: string, state: DailyRecordWriteState): void => {
  if (state.pendingCount === 0) statesByDate.delete(date);
  else statesByDate.set(date, Object.freeze(state));
  [...(listenersByDate.get(date) ?? [])].forEach(listener => {
    try {
      listener();
    } catch {
      // Presentation observers must never reject or strand a persistence turn.
    }
  });
};

export const ownsDailyRecordWriteLock = (
  lease: DailyRecordWriteLease | undefined,
  date: string
): boolean => Boolean(lease && activeLeaseDates.get(lease) === date);

/** Serializes the whole read-plan-write window with every ordinary repository write in this tab. */
export const runExclusiveDailyRecordWrite = async <T>(
  date: string,
  operation: (lease: DailyRecordWriteLease) => Promise<T>,
  options: { kind: DailyRecordWriteKind } = { kind: 'ordinary' }
): Promise<T> => {
  const previous = tailsByDate.get(date) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>(resolve => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  tailsByDate.set(date, tail);
  publishState(date, {
    ...getDailyRecordWriteState(date),
    pendingCount: getDailyRecordWriteState(date).pendingCount + 1,
  });

  await previous.catch(() => undefined);
  const lease = {} as DailyRecordWriteLease;
  activeLeaseDates.set(lease, date);
  try {
    publishState(date, { ...getDailyRecordWriteState(date), activeKind: options.kind });
    return await operation(lease);
  } finally {
    activeLeaseDates.delete(lease);
    publishState(date, {
      pendingCount: getDailyRecordWriteState(date).pendingCount - 1,
      activeKind: null,
    });
    releaseCurrent();
    if (tailsByDate.get(date) === tail) tailsByDate.delete(date);
  }
};

export const runWithDailyRecordWriteLock = <T>(
  date: string,
  lease: DailyRecordWriteLease | undefined,
  operation: () => Promise<T>
): Promise<T> =>
  ownsDailyRecordWriteLock(lease, date)
    ? operation()
    : runExclusiveDailyRecordWrite(date, () => operation());
