import { useEffect, useRef, useState } from 'react';
import { getAvailableDates, getPreviousDay } from '@/services/repositories/DailyRecordRepository';
import {
  executeLoadCensusPromptDataController,
  INITIAL_CENSUS_PROMPT_STATE,
  type CensusPromptState,
} from '@/features/census/controllers/censusLogicController';

export const useCensusPromptState = (currentDateString: string): CensusPromptState => {
  const [promptState, setPromptState] = useState(INITIAL_CENSUS_PROMPT_STATE);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let isDisposed = false;

    void (async () => {
      const nextPromptState = await executeLoadCensusPromptDataController({
        currentDateString,
        getPreviousDay,
        getAvailableDates,
      });

      if (isDisposed || requestId !== requestIdRef.current) {
        return;
      }

      setPromptState(nextPromptState);
    })();

    return () => {
      isDisposed = true;
    };
  }, [currentDateString]);

  return promptState;
};
