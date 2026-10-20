import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/config/queryClient';
import { CensusLoadingState } from '@/components/ui/CensusLoadingState';

/** A deadline changes presentation only; it never grants permission to create a day. */
export const CensusBootstrapRecovery = ({ date, failed }: { date: string; failed: boolean }) => {
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = useState(0);
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const fail = () => {
      if (active) setFailedAttempt(attempt);
    };
    const timeout = window.setTimeout(fail, 15_000);
    if (attempt > 0) {
      // Cancel a stuck read and re-read only this date. No sync/write/copy action.
      void queryClient
        .resetQueries(
          { queryKey: queryKeys.dailyRecord.byDate(date), exact: true },
          { throwOnError: true }
        )
        .catch(fail);
    }
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [attempt, date, queryClient]);

  if (!(failed && attempt === 0) && failedAttempt !== attempt) {
    return <CensusLoadingState />;
  }

  return (
    <div
      className="mx-auto mt-8 max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-5 text-center"
      role="alert"
    >
      <p>No se pudo comprobar si existe un censo para esta fecha.</p>
      <p className="mt-2 text-sm">
        Revisa tu conexión y vuelve a intentarlo. La copia seguirá bloqueada hasta confirmar que el
        día está vacío.
      </p>
      <button
        type="button"
        className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-white"
        onClick={() => setAttempt(value => value + 1)}
      >
        Reintentar
      </button>
    </div>
  );
};
