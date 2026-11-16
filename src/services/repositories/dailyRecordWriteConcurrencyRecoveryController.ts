import type { AuthoringSession } from '@/services/storage/authoringSession';
import { attemptConflictAutoMergeRecovery } from '@/services/repositories/dailyRecordConflictAutoMergeController';
import type { DailyRecordConflictSummary } from '@/services/repositories/contracts/dailyRecordConsistency';
import type { RemoteWriteRecoveryResult } from '@/services/repositories/contracts/dailyRecordWriteRecoveryResult';
import {
  buildAutoMergedRecoveryResult,
  buildThrowUnrecoverableRecoveryResult,
} from '@/services/repositories/dailyRecordWriteRecoveryResultController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { FIELD_CHANGED_ELSEWHERE_TAG } from '@/services/repositories/contracts/dailyRecordResults';
import {
  FIELD_CHANGED_ELSEWHERE_MESSAGE,
  isFieldChangedElsewhereError,
} from '@/services/storage/syncErrorCatalog';

type ConflictSummaryBuilder = (
  kind: DailyRecordConflictSummary['kind'],
  message: string
) => DailyRecordConflictSummary;

export const resolveConcurrencyRemoteWriteRecovery = async (
  date: string,
  record: DailyRecord,
  changedPaths: string[],
  error: unknown,
  buildConflictSummary: ConflictSummaryBuilder,
  authoringSession: AuthoringSession,
  allowAutoMerge: boolean = true
): Promise<RemoteWriteRecoveryResult> => {
  if (!allowAutoMerge) {
    return buildThrowUnrecoverableRecoveryResult({
      error,
      conflictSummary: buildConflictSummary(
        'concurrency',
        'El egreso ya fue reclasificado desde otra sesión; se requiere recargar antes de continuar.'
      ),
      observabilityTags: ['daily_record', 'write', 'reclassification_conflict'],
      userSafeMessage:
        'El egreso fue modificado por otro usuario. Recarga el censo antes de reclasificarlo.',
    });
  }

  const keepsOwnValue = isFieldChangedElsewhereError(error);
  const mergeResult = await attemptConflictAutoMergeRecovery(
    date,
    record,
    changedPaths,
    authoringSession,
    { keepsOwnValue }
  );
  if (mergeResult.status === 'auto_merged' && keepsOwnValue) {
    // Queued as a conflict that keeps this device's text: nothing was integrated.
    return buildAutoMergedRecoveryResult(
      buildConflictSummary('concurrency', FIELD_CHANGED_ELSEWHERE_MESSAGE),
      FIELD_CHANGED_ELSEWHERE_MESSAGE,
      ['daily_record', 'write', 'auto_merged', FIELD_CHANGED_ELSEWHERE_TAG]
    );
  }
  if (mergeResult.status === 'auto_merged') {
    return buildAutoMergedRecoveryResult(
      buildConflictSummary(
        'concurrency',
        'Se resolvió un conflicto remoto mediante fusión automática.'
      ),
      'Se resolvió un conflicto remoto mediante fusión automática.',
      ['daily_record', 'write', 'auto_merged']
    );
  }

  return buildThrowUnrecoverableRecoveryResult({
    error,
    conflictSummary: buildConflictSummary(
      'concurrency',
      'Se detectó un conflicto remoto que no pudo resolverse automáticamente.'
    ),
    observabilityTags: ['daily_record', 'write', 'conflict_unrecoverable'],
    userSafeMessage: 'Se detectó un conflicto remoto que requiere revisión manual.',
  });
};
