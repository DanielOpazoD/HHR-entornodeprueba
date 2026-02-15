import { useCallback, useEffect, useRef } from 'react';

interface SingleFlightCommandRunner {
  runSingleFlight: (task: () => Promise<void>) => boolean;
  isMounted: () => boolean;
}

export const useSingleFlightAsyncCommand = (): SingleFlightCommandRunner => {
  const isMountedRef = useRef(true);
  const isInFlightRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      isInFlightRef.current = false;
    };
  }, []);

  const isMounted = useCallback(() => isMountedRef.current, []);

  const runSingleFlight = useCallback((task: () => Promise<void>): boolean => {
    if (isInFlightRef.current) {
      return false;
    }

    isInFlightRef.current = true;
    let taskPromise: Promise<void>;

    try {
      taskPromise = task();
    } catch {
      isInFlightRef.current = false;
      return true;
    }

    void taskPromise
      .catch(() => undefined)
      .finally(() => {
        isInFlightRef.current = false;
      });

    return true;
  }, []);

  return {
    runSingleFlight,
    isMounted,
  };
};
