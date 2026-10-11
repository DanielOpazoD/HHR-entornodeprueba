import { useEffect, useMemo, useRef, useState } from 'react';
import {
  executeLoadCensusPromptDataController,
  INITIAL_CENSUS_PROMPT_STATE,
  type CensusPromptState,
} from '@/hooks/controllers/censusPromptController';
import { defaultDailyRecordReadPort } from '@/application/ports/dailyRecordPort';
import {
  DAILY_RECORD_STORE_CHANGED_EVENT,
  type DailyRecordStoreChangedEventDetail,
  isDailyRecordStoreChangeRelevantToCensusPrompt,
} from '@/services/storage/indexeddb/indexedDbRecordEvents';

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
        getPreviousDay: defaultDailyRecordReadPort.getPreviousDay,
        // Startup uses the bounded reader: it only needs the closest dates, not all history.
        getAvailableDates: () =>
          defaultDailyRecordReadPort.getRecentAvailableDates(currentDateString),
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
