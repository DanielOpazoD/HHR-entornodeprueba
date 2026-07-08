import type { DailyRecord } from '@/types/domain/dailyRecord';
import { mergeObject } from '@/services/repositories/conflictResolutionMergeUtils';
import type { ConflictResolutionTraceContext } from '@/services/repositories/conflictResolutionTrace';

const mergeRecordObject = <K extends keyof DailyRecord>(
  remote: DailyRecord,
  local: DailyRecord,
  key: K,
  preferLocal: boolean,
  traceContext: ConflictResolutionTraceContext
): DailyRecord[K] =>
  mergeObject(
    remote[key] as unknown as Record<string, unknown> | undefined,
    local[key] as unknown as Record<string, unknown> | undefined,
    preferLocal,
    traceContext,
    String(key)
  ) as DailyRecord[K];

export const mergeRecordObjectFields = (
  remote: DailyRecord,
  local: DailyRecord,
  preferLocal: boolean,
  traceContext: ConflictResolutionTraceContext
): Partial<DailyRecord> => ({
  handoffDayChecklist: mergeRecordObject(
    remote,
    local,
    'handoffDayChecklist',
    preferLocal,
    traceContext
  ),
  handoffNightChecklist: mergeRecordObject(
    remote,
    local,
    'handoffNightChecklist',
    preferLocal,
    traceContext
  ),
  medicalHandoffBySpecialty: mergeRecordObject(
    remote,
    local,
    'medicalHandoffBySpecialty',
    preferLocal,
    traceContext
  ),
  medicalSignature: mergeRecordObject(remote, local, 'medicalSignature', preferLocal, traceContext),
  medicalSignatureByScope: mergeRecordObject(
    remote,
    local,
    'medicalSignatureByScope',
    preferLocal,
    traceContext
  ),
  medicalHandoffSentAtByScope: mergeRecordObject(
    remote,
    local,
    'medicalHandoffSentAtByScope',
    preferLocal,
    traceContext
  ),
  medicalSignatureLinkTokenByScope: mergeRecordObject(
    remote,
    local,
    'medicalSignatureLinkTokenByScope',
    preferLocal,
    traceContext
  ),
});
