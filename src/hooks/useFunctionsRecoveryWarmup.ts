import { useCallback, useEffect } from 'react';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';

const warmFunctionsRuntime = async (): Promise<void> => {
  if (!navigator.onLine) return;
  await defaultFunctionsRuntime.ready;
  if (navigator.onLine) await defaultFunctionsRuntime.getFunctions();
};

export const useFunctionsRecoveryWarmup = (): (() => Promise<void>) => {
  const warmFunctions = useCallback(() => warmFunctionsRuntime(), []);

  useEffect(() => {
    const warm = () => {
      void warmFunctions().catch(() => {});
    };
    warm();
    window.addEventListener('online', warm);
    return () => window.removeEventListener('online', warm);
  }, [warmFunctions]);

  return warmFunctions;
};
