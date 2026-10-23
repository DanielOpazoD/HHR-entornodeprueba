import { useEffect, useMemo, useRef, useState } from 'react';
import {
  executeLoadCensusPromptDataController,
  INITIAL_CENSUS_PROMPT_STATE,
  type CensusPromptState,
} from '@/hooks/controllers/censusPromptController';
import { defaultDailyRecordReadPort } from '@/application/ports/dailyRecordPort';
import { getPreviousDay } from '@/utils/clinicalDayUtils';
import {
  DAILY_RECORD_STORE_CHANGED_EVENT,
  type DailyRecordStoreChangedEventDetail,
  isDailyRecordStoreChangeRelevantToCensusPrompt,
} from '@/services/storage/indexeddb/indexedDbRecordEvents';

// The empty-day prompt only offers to copy yesterday, so it reads that one day, from the device
// first. Listing the recent window used to download up to 35 whole census days for one answer.
const readYesterday = async (currentDateString: string) => {
  const yesterday = getPreviousDay(currentDateString);
  return (
    (await defaultDailyRecordReadPort.getLocalForDate(yesterday)) ??
    (await defaultDailyRecordReadPort.getForDate(yesterday))
  );
};

const NO_LISTED_DATES = async (): Promise<string[]> => [];

export const useCensusPromptState = (
  currentDateString: string,
  enabled = true
): CensusPromptState => {
  // A new demand interval must not expose results cached before it was disabled.
  const scope = useMemo(() => ({ currentDateString, enabled }), [currentDateString, enabled]);
  const [loaded, setLoaded] = useState<{
    scope: object;
    state: CensusPromptState;
  } | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const handleStoreChanged = (event: Event) => {
      const detail = (event as CustomEvent<DailyRecordStoreChangedEventDetail>).detail;
      if (!isDailyRecordStoreChangeRelevantToCensusPrompt(detail, currentDateString)) {
        return;
      }

      setReloadVersion(currentVersion => currentVersion + 1);
    };

    window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, handleStoreChanged);
    return () => window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, handleStoreChanged);
  }, [currentDateString, enabled]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let isDisposed = false;
    if (!enabled) return;

    void (async () => {
      const nextPromptState = await executeLoadCensusPromptDataController({
        currentDateString,
        getPreviousDay: readYesterday,
        getAvailableDates: NO_LISTED_DATES,
      });

      if (isDisposed || requestId !== requestIdRef.current) {
        return;
      }

      setLoaded({ scope, state: nextPromptState });
    })();

    return () => {
      isDisposed = true;
    };
  }, [currentDateString, enabled, reloadVersion, scope]);

  return enabled && loaded?.scope === scope ? loaded.state : INITIAL_CENSUS_PROMPT_STATE;
};
