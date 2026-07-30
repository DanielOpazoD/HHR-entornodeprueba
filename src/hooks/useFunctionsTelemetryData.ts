import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildDailyRecordAuthorityRolloutSummary,
  buildRayenClinicalEnrichmentRolloutSummary,
  buildServiceSummaries,
  fetchFunctionsTelemetry,
} from '@/services/admin/functionsTelemetryService';
import type {
  FunctionsTelemetryEntry,
  FunctionsTelemetryFilters,
} from '@/types/functionsTelemetry';

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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFunctionsTelemetry(limit);
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando telemetría.');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
