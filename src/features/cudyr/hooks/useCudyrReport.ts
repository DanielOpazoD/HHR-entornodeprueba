import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { loadCudyrReport } from '@/services/cudyr/cudyrReportLoader';
import { cudyrReportCache } from '@/services/cudyr/cudyrReportCache';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';

const sessionScope = () => {
  const owner = getStoredSessionOwnerKey();
  const generation = getSessionGeneration();
  return owner && generation ? `${owner}:${generation}` : '';
};
export const useCudyrReport = (
  initialDate: string,
  loader = loadCudyrReport,
  revision?: { date: string; version: string },
  refreshWindow = false
) => {
  const scope = sessionScope();
  const cache = () => cudyrReportCache(loader, scope, Boolean(scope) && loader === loadCudyrReport);
  const [data, setData] = useState<CudyrReportDataset | null>(() =>
    scope ? cache().get(initialDate.slice(0, 7) + '-01', initialDate) || null : null
  );
  const dataScope = useRef(scope);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const visibleData = useRef(data);
  visibleData.current = dataScope.current === scope ? data : null;
  const revisions = useRef(new Map<string, string>());
  const mountedRead = useRef(false);
  const load = useCallback(
    async (from: string, to: string, reuse = false) => {
      active.current?.abort();
      const request = new AbortController();
      active.current = request;
      const store = cudyrReportCache(loader, scope, Boolean(scope) && loader === loadCudyrReport);
      const cached = scope ? store.get(from, to) : undefined;
      // Invalidate freshness, retaining the last good persisted copy if verification fails.
      if (!reuse) store.requireVerification();
      setError('');
      dataScope.current = scope;
      const visible = visibleData.current;
      const lastGood = cached || (visible?.from === from && visible.to === to ? visible : null);
      setData(lastGood);
      const mustVerify =
        !mountedRead.current ||
        !reuse ||
        !cached ||
        cached.cacheVerificationRequired ||
        Date.now() - Date.parse(cached.loadedAt || cached.generatedAt) >= 120_000;
      mountedRead.current = true;
      if (!mustVerify) {
        setBusy(false);
        return;
      }
      setBusy(true);
      try {
        const loaded = await loader(from, to, request.signal);
        const result = { ...loaded, loadedAt: new Date().toISOString() };
        if (!request.signal.aborted && active.current === request && sessionScope() === scope) {
          if (scope) {
            if (result.issues.length || result.coverage.some(day => day.state === 'error'))
              store.requireVerification();
            store.put(result);
          }
          const incomplete =
            result.issues.length || result.coverage.some(day => day.state === 'error');
          if (incomplete) {
            setData(lastGood || result);
            setError(
              lastGood
                ? 'Lectura incompleta de Firebase. Se conserva la copia anterior.'
                : 'Lectura incompleta de Firebase.'
            );
          } else setData(result);
        }
      } catch (caught) {
        if (!request.signal.aborted && active.current === request && sessionScope() === scope) {
          store.requireVerification();
          setError(caught instanceof Error ? caught.message : 'No se pudo leer el reporte.');
        }
      } finally {
        if (!request.signal.aborted && active.current === request) setBusy(false);
      }
    },
    [loader, scope]
  );
  useEffect(() => {
    revisions.current.clear();
    mountedRead.current = false;
  }, [scope, loader]);
  const revisionDate = revision?.date || '';
  const revisionVersion = revision?.version || '';
  useEffect(() => {
    const store = cudyrReportCache(loader, scope, Boolean(scope) && loader === loadCudyrReport);
    if (revisionDate && revisionVersion) {
      const previous = revisions.current.get(revisionDate);
      // Approved months freeze the repaired census. Their documentary revisions
      // are checked by the server probe, not by later dailyRecord refreshes.
      const official = store.get(revisionDate.slice(0, 7) + '-01', revisionDate)?.officialSnapshot;
      if (
        !official &&
        ((previous !== undefined && previous !== revisionVersion) ||
          store.hasDifferentRevision(revisionDate, revisionVersion))
      )
        store.requireVerification();
      revisions.current.set(revisionDate, revisionVersion);
    }
    void load(initialDate.slice(0, 7) + '-01', initialDate, true);
    return () => active.current?.abort();
  }, [initialDate, load, revisionDate, revisionVersion, loader, scope]);
  // Crossing the application deadline requires a real read, not a newer label on old data.
  useEffect(() => {
    if (!refreshWindow) return;
    const attempted = new Set<string>();
    const timer = window.setInterval(() => {
      const current = visibleData.current;
      if (!current) return;
      const newlyClosed = current.coverage.filter(
        day =>
          resolveCudyrPendingStatus(day.date, new Date(current.generatedAt)).phase !== 'overdue' &&
          resolveCudyrPendingStatus(day.date).phase === 'overdue' &&
          !attempted.has(day.date)
      );
      if (newlyClosed.length) {
        newlyClosed.forEach(day => attempted.add(day.date));
        void load(current.from, current.to);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refreshWindow, load]);
  return { data: dataScope.current === scope ? data : null, busy, error, load };
};
