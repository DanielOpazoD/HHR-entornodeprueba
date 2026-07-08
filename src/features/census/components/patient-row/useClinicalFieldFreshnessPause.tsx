import React, { useCallback, useState } from 'react';
import type { ClinicalFieldFreshnessPause } from './inputCellTypes';

export const useClinicalFieldFreshnessPause = (pause: ClinicalFieldFreshnessPause | undefined) => {
  const [hintToken, setHintToken] = useState<string | undefined>();
  const [acknowledgedToken, setAcknowledgedToken] = useState<string | undefined>();
  const token = pause?.token ?? (pause ? 'clinical-freshness-pause' : undefined);
  const isPaused = Boolean(pause?.isPaused && token !== acknowledgedToken);
  const showHint = Boolean(token && token === hintToken);

  const acknowledge = useCallback(
    (event: React.SyntheticEvent<HTMLElement>) => {
      if (!isPaused) return false;
      const activePause = pause;
      if (!activePause) return false;
      event.preventDefault();
      event.stopPropagation();
      activePause.onAcknowledge();
      setAcknowledgedToken(token);
      setHintToken(token);
      event.currentTarget.blur();
      return true;
    },
    [isPaused, pause, token]
  );

  const hint =
    showHint && pause?.message ? (
      <span
        className="absolute left-1 top-full z-20 mt-0.5 rounded border border-sky-100 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 shadow-sm"
        role="status"
      >
        {pause.message}
      </span>
    ) : null;

  return {
    hint,
    pauseClassName: isPaused && !showHint ? 'ring-1 ring-sky-200 border-sky-200 bg-sky-50/40' : '',
    acknowledge,
  };
};
