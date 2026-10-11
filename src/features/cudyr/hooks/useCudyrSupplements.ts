import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  loadCudyrSupplements,
  type ArchivedCudyrSupplement,
} from '@/services/cudyr/cudyrSupplementService';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
export const useCudyrSupplements = (data: CudyrReportDataset | null) => {
  const { currentUser, role } = useAuth();
  const uid = currentUser?.uid;
  const key = data ? `${uid}:${role}:${data.from}:${data.to}:${data.generatedAt}` : '';
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    reports: ArchivedCudyrSupplement[];
    error: string;
    ready: boolean;
  }>({ key: '', reports: [], error: '', ready: false });
  useEffect(() => {
    if (!data || !uid) return;
    const controller = new AbortController();
    void loadCudyrSupplements(data.from, data.to, controller.signal)
      .then(reports => {
        if (!controller.signal.aborted) setState({ key, reports, error: '', ready: true });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            key,
            reports: [],
            error:
              'No se pudo completar la lectura del respaldo mensual. Reintente antes de exportar.',
            ready: false,
          });
      });
    return () => controller.abort();
  }, [data, key, uid, revision]);
  const reload = useCallback(() => {
    setState(s => ({ ...s, ready: false, reports: [] }));
    setRevision(r => r + 1);
  }, []);
  const current = state.key === key;
  return {
    reports: current ? state.reports : [],
    error: current ? state.error : '',
    ready: current && state.ready,
    reload,
  };
};
