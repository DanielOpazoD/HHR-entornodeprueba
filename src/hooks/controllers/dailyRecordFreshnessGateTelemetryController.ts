import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';

export type ClinicalInputsBlockReason = 'stale_due_to_inactivity' | 'refreshing_on_resume';

export type ClinicalInputsBlockFailureReason = 'resume' | 'clinical_patch' | 'clinical_save';

export type ClinicalInputsBlockCompletionSource =
  | 'query'
  | 'subscription'
  | 'manual_refresh'
  | 'write'
  | 'freshness_query';

interface ClinicalInputsBlockState {
  blockedStartedAt?: number;
}

export const recordClinicalInputsBlockStarted = (
  date: string,
  state: ClinicalInputsBlockState,
  startedAt: number,
  reason: ClinicalInputsBlockReason,
  resumeEpoch: number
): void => {
  if (typeof state.blockedStartedAt === 'number') {
    return;
  }

  state.blockedStartedAt = startedAt;
  dailyRecordObservability.recordEvent('daily_record_clinical_inputs_block_started', 'degraded', {
    runtimeState: 'recoverable',
    issues: ['Los campos clínicos quedaron bloqueados mientras se confirma Firebase.'],
    context: {
      date,
      reason,
      resumeEpoch,
    },
  });
};

export const recordClinicalInputsBlockCompleted = (
  date: string,
  state: ClinicalInputsBlockState,
  completedAt: number,
  source: ClinicalInputsBlockCompletionSource,
  resumeEpoch: number
): number | undefined => {
  if (typeof state.blockedStartedAt !== 'number') {
    return undefined;
  }

  const blockedForMs = Math.max(0, completedAt - state.blockedStartedAt);
  dailyRecordObservability.recordEvent('daily_record_clinical_inputs_block_completed', 'success', {
    issues: [],
    context: {
      date,
      source,
      endedWith: 'fresh_remote_confirmed',
      resumeEpoch,
      blockedForMs,
    },
  });
  dailyRecordObservability.recordEvent('daily_record_clinical_inputs_block_duration', 'success', {
    issues: [],
    context: {
      date,
      source,
      resumeEpoch,
      blockedForMs,
    },
  });
  state.blockedStartedAt = undefined;
  return blockedForMs;
};

export const recordClinicalInputsBlockFailed = (
  date: string,
  state: ClinicalInputsBlockState,
  reason: ClinicalInputsBlockFailureReason,
  failedAt: number,
  resumeEpoch: number
): number => {
  const blockedForMs =
    typeof state.blockedStartedAt === 'number' ? Math.max(0, failedAt - state.blockedStartedAt) : 0;
  dailyRecordObservability.recordEvent('daily_record_clinical_inputs_block_failed', 'failed', {
    runtimeState: 'blocked',
    issues: ['No se pudo confirmar Firebase y los campos clínicos siguieron bloqueados.'],
    context: {
      date,
      reason,
      resumeEpoch,
      blockedForMs,
    },
  });
  return blockedForMs;
};
