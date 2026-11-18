import { useCallback } from 'react';
import type { RefObject } from 'react';
import type {
  ApplyDailyRecordPatch,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { AuditLoggers } from '@/hooks/useAudit';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import { runHandoffMutation } from '@/hooks/controllers/handoffManagementMutationController';

interface HandoffManagementPersistenceInput {
  recordRef: RefObject<DailyRecord | null>;
  saveAndUpdate: PersistDailyRecord;
  patchRecord: ApplyDailyRecordPatch;
  logHandoffNovedadesModified: AuditLoggers['logHandoffNovedadesModified'];
  userId: string;
  notifyError: (title: string, message: string) => void;
}

interface MutationFailureOptions {
  fallbackMessage: string;
  fallbackTitle: string;
  reasonTitles?: Partial<Record<string, string>>;
}

export interface HandoffPersistenceRuntime extends HandoffManagementPersistenceInput {
  getCurrentRecord: () => DailyRecord | null;
  runMutation: <TData>(
    execute: (record: DailyRecord | null) => Promise<ApplicationOutcome<TData | null>>,
    failureOptions: MutationFailureOptions,
    onSuccess?: (context: { currentRecord: DailyRecord; data: TData }) => void | Promise<void>
  ) => Promise<unknown>;
}

export const useHandoffPersistenceRuntime = (
  input: HandoffManagementPersistenceInput
): HandoffPersistenceRuntime => {
  const { recordRef, notifyError } = input;

  const getCurrentRecord = useCallback(() => recordRef.current, [recordRef]);

  const runMutation = useCallback(
    async <TData>(
      execute: (record: DailyRecord | null) => Promise<ApplicationOutcome<TData | null>>,
      failureOptions: MutationFailureOptions,
      onSuccess?: (context: { currentRecord: DailyRecord; data: TData }) => void | Promise<void>
    ) =>
      runHandoffMutation<TData>({
        execute,
        getCurrentRecord,
        notifyError,
        failureOptions,
        onSuccess: onSuccess
          ? async ({ currentRecord, data }) => {
              await onSuccess({ currentRecord, data });
            }
          : undefined,
      }),
    [getCurrentRecord, notifyError]
  );

  return {
    ...input,
    getCurrentRecord,
    runMutation,
  };
};
