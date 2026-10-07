import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCudyrReport } from '@/services/cudyr/cudyrReportLoader';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';

export const useCudyrReport = (initialDate: string, loader = loadCudyrReport) => {
  const [data, setData] = useState<CudyrReportDataset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const load = useCallback(
    async (from: string, to: string) => {
      active.current?.abort();
      const request = new AbortController();
      active.current = request;
      setBusy(true);
      setError('');
      setData(null);
      try {
        const result = await loader(from, to, request.signal);
        if (!request.signal.aborted && active.current === request) setData(result);
      } catch (caught) {
        if (!request.signal.aborted && active.current === request)
          setError(caught instanceof Error ? caught.message : 'No se pudo leer el reporte.');
      } finally {
        if (!request.signal.aborted && active.current === request) setBusy(false);
      }
    },
    [loader]
  );
  useEffect(() => {
    void load(initialDate.slice(0, 7) + '-01', initialDate);
    return () => active.current?.abort();
  }, [initialDate, load]);
  return { data, busy, error, load };
};
