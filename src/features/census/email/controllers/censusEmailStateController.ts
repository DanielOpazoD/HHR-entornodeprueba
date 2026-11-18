import { buildCensusEmailBody } from '@/constants/email';
import type { CensusEmailSendStatus } from '@/features/census/email/hooks/useCensusEmailDeliveryActions';

interface CensusEmailMessageState {
  key: string;
  value: string;
  edited: boolean;
}

interface CensusEmailSendState {
  key: string;
  status: CensusEmailSendStatus;
  error: string | null;
}

export const createInitialCensusMessageState = (
  currentDateString: string,
  nurseSignature: string
): CensusEmailMessageState => ({
  key: currentDateString,
  value: buildCensusEmailBody(currentDateString, nurseSignature),
  edited: false,
});

export const resolveCensusEmailMessage = (
  messageState: CensusEmailMessageState,
  currentDateString: string,
  nurseSignature: string
) => {
  if (messageState.key !== currentDateString || !messageState.edited) {
    return buildCensusEmailBody(currentDateString, nurseSignature);
  }

  return messageState.value;
};

export const createInitialCensusSendState = (currentDateString: string): CensusEmailSendState => ({
  key: currentDateString,
  status: 'idle',
  error: null,
});

export const resolveDateBoundSendState = (
  sendState: CensusEmailSendState,
  currentDateString: string
) => ({
  status:
    sendState.key === currentDateString ? sendState.status : ('idle' as CensusEmailSendStatus),
  error: sendState.key === currentDateString ? sendState.error : null,
});

export const updateDateBoundStatusState = (
  previous: CensusEmailSendState,
  currentDateString: string,
  nextStatus: CensusEmailSendStatus
): CensusEmailSendState => ({
  key: currentDateString,
  status: nextStatus,
  error: previous.key === currentDateString ? previous.error : null,
});

export const updateDateBoundErrorState = (
  previous: CensusEmailSendState,
  currentDateString: string,
  nextError: string | null
): CensusEmailSendState => ({
  key: currentDateString,
  status: previous.key === currentDateString ? previous.status : 'idle',
  error: nextError,
});
