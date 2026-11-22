import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDailyRecordAuthorityRolloutSummary,
  buildRayenClinicalEnrichmentRolloutSummary,
  buildServiceSummaries,
  fetchFunctionsTelemetry,
} from '@/features/admin/services/functionsTelemetryService';
import type {
  FunctionsTelemetryEntry,
  FunctionsTelemetryFilters,
} from '@/features/admin/types/functionsTelemetry';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';

const DEFAULT_LIMIT = 500;

const matchesFilters = (
  entry: FunctionsTelemetryEntry,
  filters: FunctionsTelemetryFilters
): boolean => {
  if (filters.service && entry.service !== filters.service) return false;
  if (filters.status && entry.status !== filters.status) return false;
  if (filters.since && entry.timestamp < filters.since) return false;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const haystack =
      `${entry.operation} ${entry.errorCode ?? ''} ${entry.errorMessage ?? ''}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
};

export const useFunctionsTelemetryData = (limit: number = DEFAULT_LIMIT) => {
  const [entries, setEntries] = useState<FunctionsTelemetryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FunctionsTelemetryFilters>({});
  const requestIdRef = useRef(0);

  const showEntries = useCallback((read: Promise<FunctionsTelemetryEntry[]>) => {
    const requestId = ++requestIdRef.current;
    return read
      .then(
        nextEntries => {
          if (requestId !== requestIdRef.current) return;
          setEntries(nextEntries);
        },
        (err: unknown) => {
          if (requestId !== requestIdRef.current) return;
          setError(err instanceof Error ? err.message : 'Error cargando telemetría.');
          setEntries([]);
        }
      )
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
      });
  }, []);
  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    return showEntries(fetchFunctionsTelemetry(limit));
  }, [limit, showEntries]);

  if (useChangedOnRender([limit])) {
    setLoading(true);
    setError(null);
  }
  useEffect(() => {
    void showEntries(fetchFunctionsTelemetry(limit));
    return () => {
      requestIdRef.current += 1;
    };
  }, [limit, showEntries]);

  const filteredEntries = useMemo(
    () => entries.filter(entry => matchesFilters(entry, filters)),
    [entries, filters]
  );

  const summaries = useMemo(() => buildServiceSummaries(entries), [entries]);
  const authorityRolloutSummary = useMemo(
    () => buildDailyRecordAuthorityRolloutSummary(entries),
    [entries]
  );
  const clinicalEnrichmentRolloutSummary = useMemo(
    () => buildRayenClinicalEnrichmentRolloutSummary(entries),
    [entries]
  );

  const availableServices = useMemo(() => {
    const set = new Set(entries.map(e => e.service));
    return Array.from(set).sort();
  }, [entries]);

  return {
    entries,
    filteredEntries,
    summaries,
    authorityRolloutSummary,
    clinicalEnrichmentRolloutSummary,
    availableServices,
    loading,
    error,
    filters,
    setFilters,
    refresh,
  };
};
