import { useCallback, useEffect, useRef } from 'react';

type CensusViewMode = 'REGISTER' | 'ANALYTICS';

interface UseDeferredCensusModeUpdateParams {
  onUpdate: (mode: CensusViewMode) => void;
}

interface UseDeferredCensusModeUpdateResult {
  schedule: (mode: CensusViewMode) => void;
  cancel: () => void;
}

export const useDeferredCensusModeUpdate = ({
  onUpdate,
}: UseDeferredCensusModeUpdateParams): UseDeferredCensusModeUpdateResult => {
  const timeoutRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (mode: CensusViewMode) => {
      cancel();
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        onUpdate(mode);
      }, 0);
    },
    [cancel, onUpdate]
  );

  useEffect(() => cancel, [cancel]);

  return {
    schedule,
    cancel,
  };
};
