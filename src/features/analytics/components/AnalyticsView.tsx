/**
 * AnalyticsView - MINSAL/DEIS Statistics Dashboard
 * Hospital statistics following Chilean Ministry of Health standards
 */

import React from 'react';
import { Loader2, Download, BarChart3, RefreshCw } from 'lucide-react';
import { useMinsalStats } from '@/hooks/useMinsalStats';
import { useAuth } from '@/context/AuthContext';
import { DateRangeSelector } from './internal/DateRangeSelector';
import { MinsalKPICards } from './internal/MinsalKPICards';
import { SpecialtyBreakdownTable } from './internal/SpecialtyBreakdownTable';
import { OccupancyTrendChart } from './internal/OccupancyTrendChart';
import { CmaStatsSection } from './internal/CmaStatsSection';
import { SpecialtyReportingControls } from './internal/SpecialtyReportingControls';
import {
  AnalyticsComparisonPanel,
  AnalyticsTraceabilityPanel,
} from './internal/AnalyticsSummaryPanels';
import {
  applySpecialtyReclassificationChange,
  buildAnalyticsMovementReclassificationRows,
} from '@/features/analytics/controllers/analyticsSpecialtyReclassificationController';
import { resolveAnalyticsPresentationCopy } from '@/features/analytics/controllers/minsalAnalyticsPresentationController';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { useNotification } from '@/context/UIContext';
import { createScopedLogger } from '@/services/utils/loggerScope';
import type { SpecialtyGroupingMode } from '@/types/minsalTypes';

interface AnalyticsViewProps {
  onOpenCensusDate?: (date: string) => void;
}

const analyticsViewLogger = createScopedLogger('AnalyticsView');

type AnalyticsTab = 'summary' | 'hospitalization' | 'cma' | 'specialties' | 'traceability';

const ANALYTICS_TABS: Array<{ id: AnalyticsTab; label: string }> = [
  { id: 'summary', label: 'Resumen' },
  { id: 'hospitalization', label: 'Hospitalización' },
  { id: 'cma', label: 'CMA/PMA' },
  { id: 'specialties', label: 'Especialidades' },
  { id: 'traceability', label: 'Trazabilidad' },
];

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ onOpenCensusDate }) => {
  const copy = resolveAnalyticsPresentationCopy();
  const { error: notifyError } = useNotification();
  const auth = useAuth();
  const isAdmin = auth.role === 'admin' || auth.currentUser?.role === 'admin';
  const [specialtyGroupingMode, setSpecialtyGroupingMode] =
    React.useState<SpecialtyGroupingMode>('detailed');
  const [activeTab, setActiveTab] = React.useState<AnalyticsTab>('summary');
  const calculationOptions = React.useMemo(
    () => ({
      specialtyGroupingMode,
    }),
    [specialtyGroupingMode]
  );
  const {
    stats,
    trendData,
    allRecords,
    dateRange,
    setPreset,
    setCustomRange,
    setCurrentYearMonth,
    isLoading,
    error,
    refresh,
    comparison,
    dataQualityIssues,
    reclassifications,
    saveReclassification,
    isSavingReclassification,
  } = useMinsalStats('lastMonth', calculationOptions);

  const reclassificationRows = React.useMemo(
    () => buildAnalyticsMovementReclassificationRows(allRecords, reclassifications),
    [allRecords, reclassifications]
  );

  const handleReclassificationChange = React.useCallback(
    async (row: Parameters<typeof applySpecialtyReclassificationChange>[1], specialty: string) => {
      if (!isAdmin) return;
      const next = applySpecialtyReclassificationChange(reclassifications, row, specialty).find(
        item =>
          item.date === row.date &&
          item.movementKind === row.movementKind &&
          item.movementId === row.movementId
      );
      await saveReclassification({
        date: row.date,
        movementKind: row.movementKind,
        movementId: row.movementId,
        reportingSpecialty: next?.specialty ? String(next.specialty) : null,
      });
    },
    [isAdmin, reclassifications, saveReclassification]
  );

  const handleExportExcel = async () => {
    if (!stats) return;
    try {
      const { exportMinsalToExcel } = await import('@/services/exporters/minsalExcelExporter');
      const result = await exportMinsalToExcel(stats, trendData);
      if (result.outcome === 'failed') {
        analyticsViewLogger.error(`MINSAL Excel rejected by validation: ${result.reason}`);
        notifyError('No se pudo generar el Excel MINSAL', result.userSafeMessage);
      }
    } catch (err) {
      analyticsViewLogger.error('Error exporting analytics to Excel', err);
      notifyError(
        'Error al exportar Excel',
        'No fue posible generar el archivo. Por favor intenta nuevamente.'
      );
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin mb-2" />
        <p>Cargando estadísticas MINSAL...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-500">
        <p className="mb-4">Error: {error}</p>
        <button
          onClick={refresh}
          className="px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700"
        >
          Reintentar
        </button>
      </div>
    );
  }

  // No data state
  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <BarChart3 className="w-12 h-12 mb-4 text-slate-300" />
        <p>No hay datos suficientes para generar estadísticas.</p>
        <p className="text-sm mt-2">Comienza a registrar datos en el censo diario.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-sky-600" />
            Estadísticas MINSAL/DEIS
          </h2>
          <p className="text-slate-500 mt-1">
            Indicadores hospitalarios según estándares del Ministerio de Salud
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={refresh}
            className="p-2 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
            title="Actualizar datos"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            Exportar Excel
          </button>
        </div>
      </header>

      {/* Date Range Selector */}
      <DateRangeSelector
        currentPreset={dateRange.preset}
        customStartDate={dateRange.startDate}
        customEndDate={dateRange.endDate}
        currentYearMonth={dateRange.currentYearMonth}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        onCurrentYearMonthChange={setCurrentYearMonth}
      />

      {/* Period Info */}
      <div className="text-sm text-slate-500 bg-slate-50 px-4 py-2 rounded-lg">
        Período:{' '}
        <span className="font-medium text-slate-700">{formatDateDDMMYYYY(stats.periodStart)}</span>
        {' → '}
        <span className="font-medium text-slate-700">
          {formatDateDDMMYYYY(stats.periodEnd)}
        </span>{' '}
        <span className="text-slate-400">
          ({stats.totalDays} días con datos
          {stats.calendarDays &&
            stats.calendarDays !== stats.totalDays &&
            ` de ${stats.calendarDays} días calendario`}
          )
        </span>
      </div>

      <nav
        role="tablist"
        aria-label="Secciones de estadísticas"
        className="flex gap-2 overflow-x-auto border-b border-slate-200"
      >
        {ANALYTICS_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              activeTab === tab.id
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'summary' && (
        <section className="space-y-6">
          <MinsalKPICards stats={stats} />
          <AnalyticsComparisonPanel comparison={comparison} />
        </section>
      )}

      {activeTab === 'hospitalization' && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
            <div className="mb-4">
              <h3 className="font-bold text-slate-700">{copy.trendTitle}</h3>
              <p className="text-xs text-slate-500 mt-1">{copy.trendSubtitle}</p>
            </div>
            <OccupancyTrendChart data={trendData} />
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
            <div className="mb-4">
              <h3 className="font-bold text-slate-700">{copy.currentSnapshotTitle}</h3>
              <p className="text-xs text-slate-500 mt-1">{copy.currentSnapshotSubtitle}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-sky-50 rounded-lg p-4 text-center">
                <div className="text-4xl font-bold text-sky-600">
                  {stats.pacientesActuales ?? 0}
                </div>
                <div className="text-sm text-sky-800 mt-1">Pacientes del último registro</div>
              </div>
              <div className="bg-emerald-50 rounded-lg p-4 text-center">
                <div className="text-4xl font-bold text-emerald-600">{stats.camasLibres ?? 0}</div>
                <div className="text-sm text-emerald-800 mt-1">
                  Camas libres del último registro
                </div>
              </div>
              <div className="bg-orange-50 rounded-lg p-4 text-center">
                <div className="text-4xl font-bold text-orange-600">
                  {stats.camasBloqueadas ?? 0}
                </div>
                <div className="text-sm text-orange-800 mt-1">
                  Camas bloqueadas del último registro
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-4 text-center">
                <div className="text-4xl font-bold text-slate-700">
                  {stats.tasaOcupacionActual ?? 0}%
                </div>
                <div className="text-sm text-slate-700 mt-1">{copy.currentOccupancyLabel}</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'cma' && (
        <CmaStatsSection cma={stats.cma} onOpenCensusDate={onOpenCensusDate} />
      )}

      {activeTab === 'specialties' && (
        <section className="space-y-6">
          <SpecialtyReportingControls
            groupingMode={specialtyGroupingMode}
            rows={reclassificationRows}
            canEdit={isAdmin}
            isSaving={isSavingReclassification}
            onGroupingModeChange={setSpecialtyGroupingMode}
            onReclassificationChange={handleReclassificationChange}
          />
          <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
            <h3 className="font-bold text-slate-700 mb-4">Desglose por especialidad del período</h3>
            <SpecialtyBreakdownTable
              data={stats.porEspecialidad || []}
              records={allRecords}
              summary={stats}
              onOpenCensusDate={onOpenCensusDate}
            />
          </div>
        </section>
      )}

      {activeTab === 'traceability' && (
        <AnalyticsTraceabilityPanel
          dataQualityIssues={dataQualityIssues}
          reclassifications={reclassifications}
          onOpenCensusDate={onOpenCensusDate}
        />
      )}

      {/* Footer Info */}
      <div className="text-xs text-slate-400 text-center py-4">
        Indicadores calculados según normativa MINSAL/DEIS Chile
      </div>
    </div>
  );
};

export default AnalyticsView;
