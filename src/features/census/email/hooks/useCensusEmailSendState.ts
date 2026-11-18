import { useCallback, useMemo, useState } from 'react';
import { type CensusEmailSendStatus } from '@/features/census/email/hooks/useCensusEmailDeliveryActions';
import {
  createInitialCensusSendState,
  resolveDateBoundSendState,
  updateDateBoundErrorState,
  updateDateBoundStatusState,
} from '@/features/census/email/controllers/censusEmailStateController';

export const useCensusEmailSendState = (currentDateString: string) => {
  const [sendState, setSendState] = useState<{
    key: string;
    status: CensusEmailSendStatus;
    error: string | null;
  }>(() => createInitialCensusSendState(currentDateString));

  const { status, error } = useMemo(
    () => resolveDateBoundSendState(sendState, currentDateString),
    [currentDateString, sendState]
  );

  const setStatus = useCallback(
    (next: React.SetStateAction<CensusEmailSendStatus>) => {
      setSendState(previous => {
        const previousStatus = previous.key === currentDateString ? previous.status : 'idle';
        const nextStatus =
          typeof next === 'function'
            ? (next as (prev: CensusEmailSendStatus) => CensusEmailSendStatus)(previousStatus)
            : next;
        return updateDateBoundStatusState(previous, currentDateString, nextStatus);
      });
    },
    [currentDateString]
  );

  const setError = useCallback(
    (next: React.SetStateAction<string | null>) => {
      setSendState(previous => {
        const previousError = previous.key === currentDateString ? previous.error : null;
        const nextError =
          typeof next === 'function'
            ? (next as (prev: string | null) => string | null)(previousError)
            : next;
        return updateDateBoundErrorState(previous, currentDateString, nextError);
      });
    },
    [currentDateString]
  );

  const resetStatus = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, [setError, setStatus]);

  return {
    status,
    error,
    setStatus,
    setError,
    resetStatus,
  };
};
