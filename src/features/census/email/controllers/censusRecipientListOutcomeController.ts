import { createApplicationFailed } from '@/shared/contracts/applicationOutcomeFactories';
import type {
  ApplicationIssue,
  ApplicationOutcome,
} from '@/shared/contracts/applicationOutcomeTypes';

interface RecipientListServiceResultLike {
  issues?: ApplicationIssue[];
  userSafeMessage?: string;
}

export const buildRecipientListValidationFailure = <TData>(
  data: TData,
  message: string
): ApplicationOutcome<TData> => createApplicationFailed(data, [{ kind: 'validation', message }]);

export const buildRecipientListServiceFailure = <TData>(
  data: TData,
  result: RecipientListServiceResultLike
): ApplicationOutcome<TData> =>
  createApplicationFailed(data, result.issues ?? [], {
    userSafeMessage: result.userSafeMessage,
  });

export const buildRecipientListUnknownFailure = <TData>(
  data: TData,
  error: unknown,
  fallbackMessage: string
): ApplicationOutcome<TData> =>
  createApplicationFailed(data, [
    {
      kind: 'unknown',
      message: error instanceof Error ? error.message : fallbackMessage,
    },
  ]);
