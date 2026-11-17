import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import { createApplicationFailed } from '@/shared/contracts/applicationOutcomeFactories';

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
