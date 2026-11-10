import { getSessionEpoch } from '@/services/storage/sessionStorageTransition';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import type { OperationalOutcomeLike } from '@/services/observability/operationalTelemetryContracts';
import type { SyncQueueTelemetry } from '@/services/storage/sync';
import { getSyncQueueTelemetry } from '@/services/storage/sync';
import { deleteUnheldRecord } from '@/services/storage/indexeddb/indexedDbRecordService';
import { getTodayISO } from '@/utils/dateCoreUtils';

export const POST_DEPLOY_RECENT_RECORD_REFRESH_KEY = 'hhr_post_deploy_recent_record_refresh_v1';

const POST_DEPLOY_RECENT_RECORD_REFRESH_MARKER_VERSION = 1;

export interface PostDeployRecentRecordRefreshMarker {
  version: typeof POST_DEPLOY_RECENT_RECORD_REFRESH_MARKER_VERSION;
  reason: 'version-change';
  fromVersion: string;
  toVersion: string;
  createdAt: string;
}

export type PostDeployRecentRecordRefreshStatus =
  | 'no_marker'
  | 'skipped_queue_unavailable'
  | 'skipped_queue_not_empty'
  | 'interrupted'
  | 'completed'
  | 'failed';

export interface PostDeployRecentRecordRefreshResult {
  status: PostDeployRecentRecordRefreshStatus;
  dates: string[];
  marker: PostDeployRecentRecordRefreshMarker | null;
  queueTelemetry?: SyncQueueTelemetry;
  error?: unknown;
}

interface CreateMarkerParams {
  fromVersion: string;
  toVersion: string;
  now?: Date;
}

interface ExecutePostDeployRecentRecordRefreshParams {
  todayDateString?: string;
  readMarker?: () => PostDeployRecentRecordRefreshMarker | null;
  clearMarker?: () => void;
  readSyncQueueTelemetry?: () => Promise<SyncQueueTelemetry>;
  /** Resolves false when the day stays, because a pending write holds it. */
  deleteLocalRecord?: (date: string) => Promise<boolean>;
  syncRemoteRecord: (date: string) => Promise<
    OperationalOutcomeLike & {
      reason?: string;
      data?: { sync?: { publication?: string } | null } | null;
    }
  >;
}

const canUseBrowserStorage = (): boolean =>
  typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const formatIsoLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getPreviousIsoDate = (dateString: string): string => {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return formatIsoLocalDate(date);
};

export const resolvePostDeployRecentRecordRefreshDates = (
  todayDateString: string = getTodayISO()
): string[] => [todayDateString, getPreviousIsoDate(todayDateString)];

const isPostDeployRecentRecordRefreshMarker = (
  value: unknown
): value is PostDeployRecentRecordRefreshMarker => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PostDeployRecentRecordRefreshMarker>;
  return (
    candidate.version === POST_DEPLOY_RECENT_RECORD_REFRESH_MARKER_VERSION &&
    candidate.reason === 'version-change' &&
    typeof candidate.fromVersion === 'string' &&
    candidate.fromVersion.trim().length > 0 &&
    typeof candidate.toVersion === 'string' &&
    candidate.toVersion.trim().length > 0 &&
    typeof candidate.createdAt === 'string' &&
    candidate.createdAt.trim().length > 0
  );
};

export const writePostDeployRecentRecordRefreshMarker = ({
  fromVersion,
  toVersion,
  now = new Date(),
}: CreateMarkerParams): void => {
  if (!canUseBrowserStorage()) {
    return;
  }

  const marker: PostDeployRecentRecordRefreshMarker = {
    version: POST_DEPLOY_RECENT_RECORD_REFRESH_MARKER_VERSION,
    reason: 'version-change',
    fromVersion,
    toVersion,
    createdAt: now.toISOString(),
  };

  localStorage.setItem(POST_DEPLOY_RECENT_RECORD_REFRESH_KEY, JSON.stringify(marker));
};

export const readPostDeployRecentRecordRefreshMarker =
  (): PostDeployRecentRecordRefreshMarker | null => {
    if (!canUseBrowserStorage()) {
      return null;
    }

    const raw = localStorage.getItem(POST_DEPLOY_RECENT_RECORD_REFRESH_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isPostDeployRecentRecordRefreshMarker(parsed)) {
        return parsed;
      }
    } catch {
      // Invalid marker payloads are cleared below and never trusted.
    }

    localStorage.removeItem(POST_DEPLOY_RECENT_RECORD_REFRESH_KEY);
    return null;
  };

export const clearPostDeployRecentRecordRefreshMarker = (): void => {
  if (!canUseBrowserStorage()) {
    return;
  }

  localStorage.removeItem(POST_DEPLOY_RECENT_RECORD_REFRESH_KEY);
};

const hasPendingLocalSyncWork = (telemetry: SyncQueueTelemetry): boolean =>
  telemetry.pending > 0 || telemetry.failed > 0 || telemetry.conflict > 0 || telemetry.retrying > 0;

const recordPostDeployRefreshTelemetry = (
  status: Exclude<PostDeployRecentRecordRefreshStatus, 'no_marker'>,
  result: Omit<PostDeployRecentRecordRefreshResult, 'status'>
): void => {
  recordOperationalTelemetry(
    {
      category: 'daily_record',
      operation: 'post_deploy_recent_record_refresh',
      // An attempt that did not finish keeps its marker and runs again by itself: nobody has to
      // act on it, so it is never reported as a failure.
      status: status === 'completed' ? 'success' : 'degraded',
      issues: status === 'completed' ? [] : [status],
      context: {
        dates: result.dates,
        marker: result.marker
          ? {
              fromVersion: result.marker.fromVersion,
              toVersion: result.marker.toVersion,
              createdAt: result.marker.createdAt,
            }
          : null,
        queue: result.queueTelemetry
          ? {
              pending: result.queueTelemetry.pending,
              failed: result.queueTelemetry.failed,
              conflict: result.queueTelemetry.conflict,
              retrying: result.queueTelemetry.retrying,
              readState: result.queueTelemetry.readState,
            }
          : null,
      },
    },
    { allowSuccess: true }
  );
};

export const executePostDeployRecentRecordRefresh = async ({
  todayDateString = getTodayISO(),
  readMarker = readPostDeployRecentRecordRefreshMarker,
  clearMarker = clearPostDeployRecentRecordRefreshMarker,
  readSyncQueueTelemetry = getSyncQueueTelemetry,
  deleteLocalRecord = deleteUnheldRecord,
  syncRemoteRecord,
}: ExecutePostDeployRecentRecordRefreshParams): Promise<PostDeployRecentRecordRefreshResult> => {
  const owner = getStoredSessionOwnerKey();
  const epoch = getSessionEpoch();
  const isCurrentSession = () =>
    epoch === getSessionEpoch() && owner === getStoredSessionOwnerKey();
  const marker = readMarker();
  const dates = resolvePostDeployRecentRecordRefreshDates(todayDateString);

  if (!marker) {
    return {
      status: 'no_marker',
      dates,
      marker: null,
    };
  }

  const interrupted = (): PostDeployRecentRecordRefreshResult => ({
    status: 'interrupted',
    dates,
    marker,
  });

  try {
    if (!isCurrentSession()) return interrupted();
    const queueTelemetry = await readSyncQueueTelemetry();
    if (!isCurrentSession()) return interrupted();
    if (queueTelemetry.readState !== 'ok') {
      const result = {
        status: 'skipped_queue_unavailable' as const,
        dates,
        marker,
        queueTelemetry,
      };
      recordPostDeployRefreshTelemetry(result.status, result);
      return result;
    }

    const skipQueueNotEmpty = () => {
      const result = {
        status: 'skipped_queue_not_empty' as const,
        dates,
        marker,
        queueTelemetry,
      };
      recordPostDeployRefreshTelemetry(result.status, result);
      return result;
    };

    if (hasPendingLocalSyncWork(queueTelemetry)) return skipQueueNotEmpty();

    for (const date of dates) {
      // The telemetry above is already old, and leaves out other owners' work.
      if (!isCurrentSession()) return interrupted();
      const deleted = await deleteLocalRecord(date);
      if (!isCurrentSession()) return interrupted();
      if (!deleted) return skipQueueNotEmpty();
      const outcome = await syncRemoteRecord(date);
      if (!isCurrentSession()) return interrupted();
      // A day with no census on the server was read correctly: that is an answer, not a failure.
      // So is a read overtaken by a newer copy of the day, which the open census brought first.
      const answered =
        outcome.status === 'success' ||
        outcome.reason === 'missing_remote_record' ||
        outcome.data?.sync?.publication === 'superseded';
      if (!answered) {
        const result = { status: 'failed' as const, dates, marker, queueTelemetry };
        recordPostDeployRefreshTelemetry(result.status, result);
        return result;
      }
    }

    if (!isCurrentSession()) return interrupted();
    clearMarker();
    const result = {
      status: 'completed' as const,
      dates,
      marker,
      queueTelemetry,
    };
    recordPostDeployRefreshTelemetry(result.status, result);
    return result;
  } catch (error) {
    if (!isCurrentSession()) return interrupted();
    const result = {
      status: 'failed' as const,
      dates,
      marker,
      error,
    };
    recordPostDeployRefreshTelemetry(result.status, result);
    return result;
  }
};
