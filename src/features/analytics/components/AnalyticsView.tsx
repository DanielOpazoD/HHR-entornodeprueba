/**
 * AnalyticsView - MINSAL/DEIS Statistics Dashboard
 * Hospital statistics following Chilean Ministry of Health standards
 */

import React from 'react';
import { Loader2, Download, BarChart3, RefreshCw } from 'lucide-react';
import { useMinsalStats } from '@/hooks/useMinsalStats';
import { DateRangeSelector } from './components/DateRangeSelector';
import { MinsalKPICards } from './components/MinsalKPICards';
import { SpecialtyBreakdownTable } from './components/SpecialtyBreakdownTable';
import { OccupancyTrendChart } from './components/OccupancyTrendChart';
import { exportMinsalToExcel } from '@/services/exporters/minsalExcelExporter';
import { formatDateDDMMYYYY } from '@/utils/dateUtils';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

export const AnalyticsView: React.FC = () => {
  const {
    stats,
    trendData,
    dateRange,
    setPreset,
    setCustomRange,
    setCurrentYearMonth,
    isLoading,
    error,
    refresh,
  } = useMinsalStats('lastMonth');

  const handleExportExcel = async () => {
    if (!stats) return;
    try {
      await exportMinsalToExcel(stats, trendData);
    } catch (err) {
      console.error('Error exporting to Excel:', err);
      defaultBrowserWindowRuntime.alert('Error al exportar el archivo Excel');
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

      {/* KPI Cards */}
      <MinsalKPICards stats={stats} />

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Occupancy Trend */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-700 mb-4">Tendencia de Ocupación</h3>
          <OccupancyTrendChart data={trendData} />
        </div>

        {/* Current Snapshot */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-700 mb-4">Situación de hoy</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-sky-50 rounded-lg p-4 text-center">
              <div className="text-4xl font-bold text-sky-600">{stats.pacientesActuales ?? 0}</div>
              <div className="text-sm text-sky-800 mt-1">Pacientes Hospitalizados</div>
            </div>
            <div className="bg-emerald-50 rounded-lg p-4 text-center">
              <div className="text-4xl font-bold text-emerald-600">{stats.camasLibres ?? 0}</div>
              <div className="text-sm text-emerald-800 mt-1">Camas Libres</div>
            </div>
            <div className="bg-orange-50 rounded-lg p-4 text-center">
              <div className="text-4xl font-bold text-orange-600">{stats.camasBloqueadas ?? 0}</div>
              <div className="text-sm text-orange-800 mt-1">Camas Bloqueadas</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-4 text-center">
              <div className="text-4xl font-bold text-purple-600">
                {stats.tasaOcupacionActual ?? 0}%
              </div>
              <div className="text-sm text-purple-800 mt-1">Ocupación Actual</div>
            </div>
          </div>
        </div>
      </div>

      {/* Specialty Breakdown */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="font-bold text-slate-700 mb-4">Ocupación por Especialidad</h3>
        <SpecialtyBreakdownTable data={stats.porEspecialidad || []} />
      </div>

      {/* Footer Info */}
      <div className="text-xs text-slate-400 text-center py-4">
        Indicadores calculados según normativa MINSAL/DEIS Chile
      </div>
    </div>
  );
};

export default AnalyticsView;
