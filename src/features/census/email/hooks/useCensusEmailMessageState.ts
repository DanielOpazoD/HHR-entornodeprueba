import { useCallback, useMemo, useState } from 'react';
import {
  createInitialCensusMessageState,
  resolveCensusEmailMessage,
} from '@/features/census/email/controllers/censusEmailStateController';

export const useCensusEmailMessageState = (currentDateString: string, nurseSignature: string) => {
  const [messageState, setMessageState] = useState<{
    key: string;
    value: string;
    edited: boolean;
  }>(() => createInitialCensusMessageState(currentDateString, nurseSignature));

  const message = useMemo(
    () => resolveCensusEmailMessage(messageState, currentDateString, nurseSignature),
    [currentDateString, nurseSignature, messageState]
  );

  const onMessageChange = useCallback(
    (value: string) => {
      setMessageState({
        key: currentDateString,
        value,
        edited: true,
      });
    },
    [currentDateString]
  );

  const onResetMessage = useCallback(() => {
    setMessageState(createInitialCensusMessageState(currentDateString, nurseSignature));
  }, [currentDateString, nurseSignature]);

  return {
    message,
    onMessageChange,
    onResetMessage,
  };
};
