import { useEffect, useState } from 'react';

export const useDeferredCensusEnhancement = (enabled: boolean): boolean => {
  const [isDeferredEnabled, setIsDeferredEnabled] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsDeferredEnabled(enabled);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [enabled]);

  return enabled && isDeferredEnabled;
};
