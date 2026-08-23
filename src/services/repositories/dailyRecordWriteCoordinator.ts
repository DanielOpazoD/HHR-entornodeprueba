declare const dailyRecordWriteLeaseBrand: unique symbol;

/** Opaque proof that the caller owns the in-tab write slot for one census date. */
export interface DailyRecordWriteLease {
  readonly [dailyRecordWriteLeaseBrand]: true;
}

const tailsByDate = new Map<string, Promise<void>>();
const activeLeaseDates = new WeakMap<object, string>();

export const ownsDailyRecordWriteLock = (
  lease: DailyRecordWriteLease | undefined,
  date: string
): boolean => Boolean(lease && activeLeaseDates.get(lease) === date);

/** Serializes the whole read-plan-write window with every ordinary repository write in this tab. */
export const runExclusiveDailyRecordWrite = async <T>(
  date: string,
  operation: (lease: DailyRecordWriteLease) => Promise<T>
): Promise<T> => {
  const previous = tailsByDate.get(date) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>(resolve => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  tailsByDate.set(date, tail);

  await previous.catch(() => undefined);
  const lease = {} as DailyRecordWriteLease;
  activeLeaseDates.set(lease, date);
  try {
    return await operation(lease);
  } finally {
    activeLeaseDates.delete(lease);
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
