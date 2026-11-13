import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  createApplicationDegraded,
  createApplicationFailed,
  createApplicationPartial,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome, UseCase } from '@/shared/contracts/applicationOutcomeTypes';

import {
  defaultDailyRecordSyncPort,
  type DailyRecordSyncPort,
} from '@/application/ports/dailyRecordPort';

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
  sync: SyncDailyRecordResult | null;
  degradationReason?: SyncDegradationReason;
  conflict?: SyncConflictDescriptor;
}

export interface SyncDailyRecordInput {
  date: string;
  repository?: DailyRecordSyncPort;
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

export class SyncDailyRecordUseCase implements UseCase<SyncDailyRecordInput, SyncOutcome> {
  async execute(input: SyncDailyRecordInput): Promise<ApplicationOutcome<SyncOutcome>> {
    const repository = input.repository || defaultDailyRecordSyncPort;
    try {
      const sync = await repository.syncWithFirestoreDetailed(input.date);

      if (!sync) {
        return createApplicationPartial(
          {
            record: null,
            sync: null,
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

      if (sync.consistencyState === 'blocked') {
        return createApplicationDegraded(
          {
            record: sync.record,
            sync,
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
              syncOutcome: sync.consistencyState,
            },
            telemetryTags: ['sync', 'remote_blocked'],
          }
        );
      }

      if (sync.consistencyState === 'missing_remote') {
        return createApplicationPartial(
          {
            record: sync.record,
            sync,
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
              syncOutcome: sync.consistencyState,
            },
            telemetryTags: ['sync', 'missing_remote_record'],
          }
        );
      }

      return createApplicationSuccess({
        record: sync.record,
        sync,
      });
    } catch (error) {
      return createApplicationFailed(
        {
          record: null,
          sync: null,
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
  }
}

export const executeSyncDailyRecord = async (
  input: SyncDailyRecordInput
): Promise<ApplicationOutcome<SyncOutcome>> => new SyncDailyRecordUseCase().execute(input);
