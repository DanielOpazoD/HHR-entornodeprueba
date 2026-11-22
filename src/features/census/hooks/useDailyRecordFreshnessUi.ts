import { useMemo, useSyncExternalStore } from 'react';
import {
  didDailyRecordFreshnessHydrateNewerRemoteForDate,
  getDailyRecordFreshnessStatus,
  getDailyRecordClinicalFieldLocksByBedId,
  getDailyRecordLastRemoteConfirmedAt,
  subscribeDailyRecordFreshness,
  type DailyRecordFreshnessStatus,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import type { HydratedRemoteClinicalFieldLocksByBedId } from '@/hooks/controllers/dailyRecordHydratedRemotePatchRiskController';

export interface DailyRecordFreshnessUiState {
  status: DailyRecordFreshnessStatus;
  isClinicalEditingBlocked: boolean;
  isQuietlyRefreshing: boolean;
  remoteHydratedNewerRecord: boolean;
  clinicalFieldLocksByBedId: HydratedRemoteClinicalFieldLocksByBedId;
  lastRemoteConfirmedAt?: number;
}

const BLOCKING_FRESHNESS_STATUSES = new Set<DailyRecordFreshnessStatus>([
  'stale_due_to_inactivity',
  'refreshing_on_resume',
  'blocked_until_remote_check',
]);

export const useDailyRecordFreshnessUi = (date: string): DailyRecordFreshnessUiState => {
  const snapshot = useSyncExternalStore(
    subscribeDailyRecordFreshness,
    () => getDailyRecordFreshnessStatus(date),
    () => 'fresh_remote_confirmed' as const
  );
  const remoteHydratedNewerRecord = didDailyRecordFreshnessHydrateNewerRemoteForDate(date);
  const clinicalFieldLocksByBedId = getDailyRecordClinicalFieldLocksByBedId(date);
  const lastRemoteConfirmedAt = getDailyRecordLastRemoteConfirmedAt(date);

  return useMemo(
    () => ({
      status: snapshot,
      isClinicalEditingBlocked: BLOCKING_FRESHNESS_STATUSES.has(snapshot),
      isQuietlyRefreshing:
        snapshot === 'stale_due_to_inactivity' || snapshot === 'refreshing_on_resume',
      remoteHydratedNewerRecord,
      clinicalFieldLocksByBedId,
      lastRemoteConfirmedAt,
    }),
    [clinicalFieldLocksByBedId, lastRemoteConfirmedAt, remoteHydratedNewerRecord, snapshot]
  );
};
