import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

export const resolveClinicalDocumentOutcomeError = <T>(
  outcome: ApplicationOutcome<T>,
  fallback: string
): string | null => {
  if (outcome.status === 'success') {
    return null;
  }

  return (
    outcome.userSafeMessage ||
    outcome.issues[0]?.userSafeMessage ||
    outcome.issues[0]?.message ||
    fallback
  );
};

export const resolveClinicalDocumentExceptionMessage = (
  error: unknown,
  fallback: string
): string => (error instanceof Error ? error.message : fallback);

export const shouldClearSelectedClinicalDocument = (
  selectedDocumentId: string | null,
  targetDocumentId: string
): boolean => selectedDocumentId === targetDocumentId;
