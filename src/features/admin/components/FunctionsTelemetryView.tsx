import React from 'react';
import { Activity } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useFunctionsTelemetryData } from '@/hooks/useFunctionsTelemetryData';
import { canAccessFunctionsTelemetryView } from '@/services/admin/functionsTelemetryAccessPolicy';
import { AccessRestricted } from './internal/AccessRestricted';
import { DailyRecordAuthorityRolloutCard } from './internal/functionsTelemetry/DailyRecordAuthorityRolloutCard';
import { FunctionsTelemetrySummaryCards } from './internal/functionsTelemetry/FunctionsTelemetrySummaryCards';
import { FunctionsTelemetryFilters } from './internal/functionsTelemetry/FunctionsTelemetryFilters';
import { FunctionsTelemetryTable } from './internal/functionsTelemetry/FunctionsTelemetryTable';
import { RayenClinicalEnrichmentRolloutCard } from './internal/functionsTelemetry/RayenClinicalEnrichmentRolloutCard';

export const FunctionsTelemetryView: React.FC = () => {
  const { role } = useAuth();
  const {
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
  } = useFunctionsTelemetryData();

  if (!canAccessFunctionsTelemetryView(role)) {
    return <AccessRestricted />;
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
          <Activity size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Telemetría de Servicios</h1>
          <p className="text-xs text-slate-500">
            Observabilidad de Netlify Functions (Gmail, Gemini, MMRAD, FHIR, WhatsApp, Syslab).
            Append-only.
          </p>
        </div>
      </header>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <DailyRecordAuthorityRolloutCard summary={authorityRolloutSummary} />

      <RayenClinicalEnrichmentRolloutCard summary={clinicalEnrichmentRolloutSummary} />

      <FunctionsTelemetrySummaryCards summaries={summaries} />

      <FunctionsTelemetryFilters
        filters={filters}
        availableServices={availableServices}
        onChange={setFilters}
        onRefresh={refresh}
        loading={loading}
      />

      <FunctionsTelemetryTable entries={filteredEntries} />
    </div>
  );
};
