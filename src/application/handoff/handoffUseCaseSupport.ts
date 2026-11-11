import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

export const createMissingRecordOutcome = <T>(
  data: T,
  operation: string,
  fallbackMessage: string
): ApplicationOutcome<T> =>
  createApplicationFailed(
    data,
    [
      {
        kind: 'validation',
        message: fallbackMessage,
        userSafeMessage: fallbackMessage,
        severity: 'warning',
        technicalContext: { operation },
        telemetryTags: ['handoff', operation, 'missing_record'],
      },
    ],
    {
      reason: 'missing_record',
      userSafeMessage: fallbackMessage,
      retryable: false,
      severity: 'warning',
      technicalContext: { operation },
      telemetryTags: ['handoff', operation, 'missing_record'],
    }
  );

export const createValidationOutcome = <T>(
  data: T,
  operation: string,
  reason: string,
  message: string
): ApplicationOutcome<T> =>
  createApplicationFailed(
    data,
    [
      {
        kind: 'validation',
        message,
        userSafeMessage: message,
        severity: 'warning',
        technicalContext: { operation, reason },
        telemetryTags: ['handoff', operation, reason],
      },
    ],
    {
      reason,
      userSafeMessage: message,
      retryable: false,
      severity: 'warning',
      technicalContext: { operation, reason },
      telemetryTags: ['handoff', operation, reason],
    }
  );

export const createNoEffectOutcome = <T>(
  data: T,
  operation: string,
  message: string
): ApplicationOutcome<T> =>
  createApplicationSuccess(data, [], {
    reason: 'no_effect',
    userSafeMessage: message,
    retryable: false,
    severity: 'info',
    technicalContext: { operation },
    telemetryTags: ['handoff', operation, 'no_effect'],
  });

export const createUnknownOutcome = <T>(
  data: T,
  operation: string,
  fallbackMessage: string,
  error: unknown
): ApplicationOutcome<T> => {
  const errorMessage = error instanceof Error ? error.message : fallbackMessage;

  return createApplicationFailed(
    data,
    [
      {
        kind: 'unknown',
        message: errorMessage,
        userSafeMessage: fallbackMessage,
        retryable: true,
        severity: 'error',
        technicalContext: { operation, errorMessage },
        telemetryTags: ['handoff', operation, 'unexpected_failure'],
      },
    ],
    {
      reason: 'unexpected_failure',
      userSafeMessage: fallbackMessage,
      retryable: true,
      severity: 'error',
      technicalContext: { operation, errorMessage },
      telemetryTags: ['handoff', operation, 'unexpected_failure'],
    }
  );
};

export const buildPatchedRecord = (
  record: HandoffDailyRecordContract,
  patch: DailyRecordPatch
): HandoffDailyRecordContract => ({
  ...record,
  ...patch,
});
