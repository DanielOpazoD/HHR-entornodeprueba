import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  createApplicationDegraded,
  createApplicationFailed,
  createApplicationPartial,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

export type SyncDegradationReason = 'missing_remote_record' | 'remote_blocked';
export type SyncConflictSeverity = 'warning' | 'error';
export type SyncRetryStrategy = 'automatic_retry' | 'manual_retry' | 'manual_review';
export type SyncRecoveryAction =
  | 'review_remote_record'
  | 'continue_with_local_copy'
  | 'retry_sync'
  | 'escalate_support';

export interface SyncConflictDescriptor {
  kind: SyncDegradationReason | 'sync_failed';
  severity: SyncConflictSeverity;
  retryStrategy: SyncRetryStrategy;
  recommendedAction: SyncRecoveryAction;
  runbook: 'docs/RUNBOOK_SYNC_RESILIENCE.md';
}

export interface SyncOutcome {
  record: DailyRecord | null;
  degradationReason?: SyncDegradationReason;
  conflict?: SyncConflictDescriptor;
}

export interface SyncDailyRecordInput {
  date: string;
  /** One remote read of the day, published where the census shows it. */
  read: (date: string) => Promise<DailyRecordQueryResult>;
}

const buildSyncConflict = (kind: SyncConflictDescriptor['kind']): SyncConflictDescriptor => {
  if (kind === 'remote_blocked') {
    return {
      kind,
      severity: 'warning',
      retryStrategy: 'manual_review',
      recommendedAction: 'continue_with_local_copy',
      runbook: 'docs/RUNBOOK_SYNC_RESILIENCE.md',
    };
  }

  if (kind === 'missing_remote_record') {
    return {
      kind,
      severity: 'warning',
      retryStrategy: 'manual_retry',
      recommendedAction: 'review_remote_record',
      runbook: 'docs/RUNBOOK_SYNC_RESILIENCE.md',
    };
  }

  return {
    kind,
    severity: 'error',
    retryStrategy: 'automatic_retry',
    recommendedAction: 'retry_sync',
    runbook: 'docs/RUNBOOK_SYNC_RESILIENCE.md',
  };
};

export const executeSyncDailyRecord = async (
  input: SyncDailyRecordInput
): Promise<ApplicationOutcome<SyncOutcome>> => {
  try {
    if (!isFirestoreEnabled()) {
      return createApplicationPartial(
        {
          record: null,
          degradationReason: 'missing_remote_record',
          conflict: buildSyncConflict('missing_remote_record'),
        },
        [
          {
            kind: 'not_found',
            message: 'No hay fuente remota disponible para sincronizar este día.',
            userSafeMessage: 'No hay fuente remota disponible para este día.',
            retryable: true,
            severity: 'warning',
            telemetryTags: ['sync', 'missing_remote_record'],
          },
        ],
        {
          reason: 'missing_remote_record',
          userSafeMessage: 'No hay fuente remota disponible para este día.',
          retryable: true,
          severity: 'warning',
          technicalContext: {
            date: input.date,
          },
          telemetryTags: ['sync', 'missing_remote_record'],
        }
      );
    }

    const { record, runtime } = await input.read(input.date);

    if (!runtime.serverConfirmed) {
      return createApplicationDegraded(
        {
          record,
          degradationReason: 'remote_blocked',
          conflict: buildSyncConflict('remote_blocked'),
        },
        [
          {
            kind: 'remote_blocked',
            message: 'La sincronización remota quedó bloqueada; se mantiene la copia local.',
            userSafeMessage:
              'La copia local se mantuvo porque la sincronización remota quedó bloqueada.',
            retryable: true,
            severity: 'warning',
            telemetryTags: ['sync', 'remote_blocked'],
          },
        ],
        {
          reason: 'remote_blocked',
          userSafeMessage:
            'La copia local se mantuvo porque la sincronización remota quedó bloqueada.',
          retryable: true,
          severity: 'warning',
          technicalContext: {
            date: input.date,
            syncOutcome: runtime.consistencyState,
          },
          telemetryTags: ['sync', 'remote_blocked'],
        }
      );
    }

    // The server confirmed it has no such day, whether or not this computer keeps a copy or a
    // queued write for it: the copy and the queue stay as they are (SAVE-01).
    if (
      runtime.availabilityState === 'confirmed_missing' ||
      runtime.conflictSummary?.kind === 'remote_missing'
    ) {
      return createApplicationPartial(
        {
          record,
          degradationReason: 'missing_remote_record',
          conflict: buildSyncConflict('missing_remote_record'),
        },
        [
          {
            kind: 'not_found',
            message: 'No se encontró registro remoto para este día.',
            userSafeMessage: 'No se encontró registro remoto para este día.',
            retryable: true,
            severity: 'warning',
            telemetryTags: ['sync', 'missing_remote_record'],
          },
        ],
        {
          reason: 'missing_remote_record',
          userSafeMessage: 'No se encontró registro remoto para este día.',
          retryable: true,
          severity: 'warning',
          technicalContext: {
            date: input.date,
            syncOutcome: runtime.consistencyState,
          },
          telemetryTags: ['sync', 'missing_remote_record'],
        }
      );
    }

    return createApplicationSuccess({ record });
  } catch (error) {
    return createApplicationFailed(
      {
        record: null,
        conflict: buildSyncConflict('sync_failed'),
      },
      [
        {
          kind: 'unknown',
          message:
            error instanceof Error ? error.message : 'No se pudo completar la sincronización.',
          userSafeMessage: 'No se pudo completar la sincronización.',
          retryable: true,
          severity: 'error',
          telemetryTags: ['sync', 'failed'],
        },
      ],
      {
        reason: 'sync_failed',
        userSafeMessage: 'No se pudo completar la sincronización.',
        retryable: true,
        severity: 'error',
        technicalContext: {
          date: input.date,
        },
        telemetryTags: ['sync', 'failed'],
      }
    );
  }
};
