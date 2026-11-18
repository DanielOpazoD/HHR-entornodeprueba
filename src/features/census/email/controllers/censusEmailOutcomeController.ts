import {
  isApplicationOutcomeNonFailure,
  isApplicationOutcomeSuccess,
  type ApplicationOutcome,
} from '@/shared/contracts/applicationOutcomeTypes';
import {
  joinApplicationIssueMessages,
  resolvePrimaryApplicationIssueMessage,
} from '@/shared/contracts/applicationOutcomeMessage';
import type { OperationalNotice } from '@/shared/feedback/operationalNoticePolicy';

interface CensusEmailOutcomePresentation {
  nextStatus: 'success' | 'error';
  error: string | null;
  alertTitle?: string;
  alertMessage?: string;
  state?: OperationalNotice['state'];
  actionRequired?: boolean;
}

export const resolveCensusEmailSendOutcomePresentation = <T>(
  result: ApplicationOutcome<T>,
  options: {
    fallbackErrorMessage: string;
    partialTitle: string;
    errorTitle: string;
    validationTitle?: string;
    shouldUseValidationTitle?: boolean;
  }
): CensusEmailOutcomePresentation => {
  if (isApplicationOutcomeSuccess(result)) {
    return {
      nextStatus: 'success',
      error: null,
      state: 'ok',
      actionRequired: false,
    };
  }

  if (isApplicationOutcomeNonFailure(result)) {
    return {
      nextStatus: 'success',
      error: null,
      alertTitle: options.partialTitle,
      alertMessage: joinApplicationIssueMessages(result.issues),
      state: result.status === 'partial' ? 'pending' : 'degraded',
      actionRequired: false,
    };
  }

  const errorMessage = resolvePrimaryApplicationIssueMessage(
    result.issues,
    options.fallbackErrorMessage
  );
  const useValidationTitle =
    options.shouldUseValidationTitle && result.issues[0]?.kind === 'validation';

  return {
    nextStatus: 'error',
    error: errorMessage,
    alertTitle: useValidationTitle ? options.validationTitle : options.errorTitle,
    alertMessage: errorMessage,
    state: 'blocked',
    actionRequired: true,
  };
};
