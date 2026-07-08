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

export type DailyRecordFreshnessMessageLevel = 'none' | 'subtle' | 'notice' | 'warning';

export interface DailyRecordFreshnessUiState {
  status: DailyRecordFreshnessStatus;
  isClinicalEditingBlocked: boolean;
  isQuietlyRefreshing: boolean;
  remoteHydratedNewerRecord: boolean;
  clinicalFieldLocksByBedId: HydratedRemoteClinicalFieldLocksByBedId;
  lastRemoteConfirmedAt?: number;
  messageLevel: DailyRecordFreshnessMessageLevel;
  userMessage?: string;
}

const BLOCKING_FRESHNESS_STATUSES = new Set<DailyRecordFreshnessStatus>([
  'stale_due_to_inactivity',
  'refreshing_on_resume',
  'blocked_until_remote_check',
]);

const resolveFreshnessMessageLevel = (
  status: DailyRecordFreshnessStatus
): DailyRecordFreshnessMessageLevel => {
  if (status === 'blocked_until_remote_check') {
    return 'warning';
  }
  return 'none';
};

const resolveFreshnessUserMessage = (status: DailyRecordFreshnessStatus): string | undefined => {
  if (status === 'blocked_until_remote_check') {
    return 'Estamos actualizando los datos. Intente nuevamente en unos segundos.';
  }
  return undefined;
};

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
      messageLevel: resolveFreshnessMessageLevel(snapshot),
      userMessage: resolveFreshnessUserMessage(snapshot),
    }),
    [clinicalFieldLocksByBedId, lastRemoteConfirmedAt, remoteHydratedNewerRecord, snapshot]
  );
};
