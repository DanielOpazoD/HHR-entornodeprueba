/**
 * Pre-write copies in dailyRecords/{date}/history are a manual safety net: no code reads them
 * (version restore uses conflictSnapshots/). A device keeps at most one per document per hour, so
 * a busy shift stops uploading the whole day with every save. Explicit 'snapshot' requests, such
 * as the single copy before each clinical import run, bypass this cadence.
 * See docs/ADR_DAILY_RECORD_DOCUMENT_GRANULARITY.md (phase 0).
 */
export const HISTORY_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;

// Shared by the device's tabs. Logout clears it, so a new session's first save copies again.
const STORAGE_KEY = 'hhr_history_snapshot_cadence_v1';
// Entries older than this can no longer suppress a copy; drop them so the map stays small.
const RETENTION_MS = 2 * 24 * HISTORY_SNAPSHOT_INTERVAL_MS;

let memoryFallback: Record<string, number> = {};

const readTakenAt = (): Record<string, number> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
  } catch {
    // Unavailable or malformed storage falls back to what this tab wrote.
  }
  return memoryFallback;
};

const writeTakenAt = (takenAt: Record<string, number>): void => {
  memoryFallback = takenAt;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(takenAt));
  } catch {
    // Without storage the in-memory map still bounds copies for this tab.
  }
};

export const isHistorySnapshotDue = (documentPath: string, now = Date.now()): boolean => {
  const takenAt = readTakenAt()[documentPath];
  return (
    typeof takenAt !== 'number' ||
    !Number.isFinite(takenAt) ||
    now - takenAt >= HISTORY_SNAPSHOT_INTERVAL_MS ||
    takenAt > now
  );
};

export const markHistorySnapshotTaken = (documentPath: string, now = Date.now()): void => {
  const kept = Object.fromEntries(
    Object.entries(readTakenAt()).filter(
      ([, takenAt]) => typeof takenAt === 'number' && now - takenAt < RETENTION_MS
    )
  );
  writeTakenAt({ ...kept, [documentPath]: now });
};
