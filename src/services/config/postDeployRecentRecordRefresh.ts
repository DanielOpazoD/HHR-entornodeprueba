import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import type { OperationalOutcomeLike } from '@/services/observability/operationalTelemetryContracts';
import type { SyncQueueTelemetry } from '@/services/storage/sync';
import { getSyncQueueTelemetry } from '@/services/storage/sync';
import { deleteRecord } from '@/services/storage/indexeddb/indexedDbRecordService';
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
  deleteLocalRecord?: (date: string) => Promise<void>;
  syncRemoteRecord: (date: string) => Promise<OperationalOutcomeLike>;
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
      status: status === 'completed' ? 'success' : status === 'failed' ? 'failed' : 'degraded',
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
  deleteLocalRecord = deleteRecord,
  syncRemoteRecord,
}: ExecutePostDeployRecentRecordRefreshParams): Promise<PostDeployRecentRecordRefreshResult> => {
  const marker = readMarker();
  const dates = resolvePostDeployRecentRecordRefreshDates(todayDateString);

  if (!marker) {
    return {
      status: 'no_marker',
      dates,
      marker: null,
    };
  }

  try {
    const queueTelemetry = await readSyncQueueTelemetry();
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

    if (hasPendingLocalSyncWork(queueTelemetry)) {
      const result = {
        status: 'skipped_queue_not_empty' as const,
        dates,
        marker,
        queueTelemetry,
      };
      recordPostDeployRefreshTelemetry(result.status, result);
      return result;
    }

    for (const date of dates) {
      await deleteLocalRecord(date);
      await syncRemoteRecord(date);
    }

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
