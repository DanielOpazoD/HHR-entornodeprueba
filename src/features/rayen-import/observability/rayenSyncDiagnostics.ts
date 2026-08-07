import type { RayenSyncFailureReason } from '@/types/domain/rayenSync';
import { logger } from '@/services/utils/loggerService';

const rayenSyncLogger = logger.child('RayenSync');

export type RayenSyncOperationalErrorKind =
  | 'concurrency'
  | 'timeout'
  | 'unavailable'
  | 'policy_unavailable'
  | 'unsupported'
  | 'invalid_response'
  | 'unexpected';

export type RayenSyncDiagnosticCode =
  | 'clinical_batch_local_refresh_deferred'
  | 'clinical_batch_shadow_observation_failed'
  | 'clinical_batch_shadow_refresh_failed'
  | 'clinical_fill_failed'
  | 'clinical_fill_partial'
  | 'clinical_fill_queue_task_failed'
  | 'clinical_fill_superseded'
  | 'clinical_record_load_failed'
  | 'sync_audit_event_missing'
  | 'sync_audit_persist_failed'
  | 'sync_audit_terminal_recovery_failed';

export type RayenSyncTerminalOutcome = 'complete' | 'partial' | 'failed' | 'cancelled';

interface RayenSyncDiagnosticData {
  runId?: string;
  batchRunId?: string;
  outcome?: RayenSyncTerminalOutcome;
  failureReason?: RayenSyncFailureReason;
  cancellationReason?: 'operator' | 'superseded';
  errorKind?: RayenSyncOperationalErrorKind;
  issueCount?: number;
  patientCount?: number;
  batchMode?: 'shadow' | 'enforced';
  durationMs?: number;
}

const errorText = (error: unknown): string => {
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown } | null;
  return [candidate?.code, candidate?.name, candidate?.message]
    .map(value => String(value ?? '').toLowerCase())
    .join(' ');
};

/** Converts provider/runtime errors into a bounded category; raw messages never enter telemetry. */
export const classifyRayenSyncError = (error: unknown): RayenSyncOperationalErrorKind => {
  const detail = errorText(error);
  if (
    /rayen-clinical-policy-changed|clinical_policy_unavailable|pol[ií]tica cl[ií]nica/.test(detail)
  ) {
    return 'policy_unavailable';
  }
  if (
    /\baborted\b|concurr|contention|modificado por otro usuario|actualiz[oó] hace un momento/.test(
      detail
    )
  ) {
    return 'concurrency';
  }
  if (/timeout|timed out|deadline|abort/.test(detail)) return 'timeout';
  if (/not-found|unimplemented|unsupported|no admite/.test(detail)) return 'unsupported';
  if (/unavailable|network|fetch|offline|cors/.test(detail)) return 'unavailable';
  if (/invalid|parity|confirmaci[oó]n/.test(detail)) return 'invalid_response';
  return 'unexpected';
};

export const reportRayenSyncWarning = (
  code: RayenSyncDiagnosticCode,
  data: RayenSyncDiagnosticData = {}
): void => {
  rayenSyncLogger.warn(code, data);
};

export const reportRayenSyncTerminal = (
  run: { id: string; startedAt: string },
  outcome: RayenSyncTerminalOutcome,
  data: Omit<RayenSyncDiagnosticData, 'runId' | 'outcome' | 'durationMs'> = {},
  completedAt = new Date().toISOString()
): void => {
  const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(run.startedAt));
  const payload = {
    ...data,
    runId: run.id,
    outcome,
    ...(Number.isFinite(durationMs) ? { durationMs } : {}),
  };
  if (outcome === 'failed') {
    rayenSyncLogger.warn('run_terminal', payload);
    return;
  }
  rayenSyncLogger.info('run_terminal', payload);
};
