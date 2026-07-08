import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import {
  buildHydratedRemoteClinicalFieldLocks,
  type HydratedRemoteClinicalFieldLocksByBedId,
} from '@/hooks/controllers/dailyRecordHydratedRemotePatchRiskController';

export interface DailyRecordRemoteConfirmationState {
  remoteHydratedNewerRecord: boolean;
  clinicalFieldLocksByBedId: HydratedRemoteClinicalFieldLocksByBedId;
  lastConfirmedRecord?: DailyRecord | null;
}

export interface DailyRecordRemoteConfirmationParams {
  source?: 'query' | 'subscription' | 'manual_refresh' | 'write';
  remoteHydratedNewerRecord?: boolean;
  previousRecord?: DailyRecord | null;
  confirmedRecord?: DailyRecord | null;
}

const toRecordTimestamp = (value: string | undefined): number => {
  if (!value) return 0;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : 0;
};

export const applyDailyRecordRemoteConfirmation = (
  state: DailyRecordRemoteConfirmationState,
  params: DailyRecordRemoteConfirmationParams
): { builtLocks: boolean } => {
  const previousRecord = state.lastConfirmedRecord ?? params.previousRecord;
  const didConfirmNewerRecord =
    previousRecord &&
    params.confirmedRecord &&
    toRecordTimestamp(params.confirmedRecord.lastUpdated) >
      toRecordTimestamp(previousRecord.lastUpdated);
  const shouldBuildLocks =
    params.source !== 'write' &&
    (params.remoteHydratedNewerRecord === true || didConfirmNewerRecord === true);

  state.remoteHydratedNewerRecord = shouldBuildLocks || state.remoteHydratedNewerRecord;
  if (shouldBuildLocks) {
    state.clinicalFieldLocksByBedId = buildHydratedRemoteClinicalFieldLocks({
      previousRecord,
      hydratedRecord: params.confirmedRecord,
    });
  }
  if (params.confirmedRecord) {
    state.lastConfirmedRecord = params.confirmedRecord;
  }
  return { builtLocks: shouldBuildLocks };
};
