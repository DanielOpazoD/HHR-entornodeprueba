/**
 * @module LabViewerTrendCharts
 * @description Trend line charts grouped by clinical category with scale-aware sub-charts.
 */

import React from 'react';
import { SearchX, TrendingUp } from 'lucide-react';
import { LabChartErrorBoundary } from './LabChartErrorBoundary';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import { LabTrendGroupCard } from './LabTrendGroupCard';
import { LabTrendToolbar } from './LabTrendToolbar';
import { LabTrendFocusStrip } from './LabTrendFocusStrip';
import {
  collectLabTrendFocusResults,
  countLabTrendVariables,
  filterLabTrendGroups,
  type LabTrendTimeRange,
} from '../controllers/labTrendFilterController';

// === MAIN COMPONENT ===

export const LabViewerTrendCharts: React.FC<{
  data: LabAnalysisData;
  chartsRef?: React.RefObject<HTMLDivElement | null>;
}> = ({ data, chartsRef }) => {
  const localChartsRef = React.useRef<HTMLDivElement>(null);
  const resolvedChartsRef = chartsRef || localChartsRef;
  const [timeRange, setTimeRange] = React.useState<LabTrendTimeRange>('all');
  const [searchTerm, setSearchTerm] = React.useState('');
  const [onlyAbnormal, setOnlyAbnormal] = React.useState(false);
  const [activeDate, setActiveDate] = React.useState<string | null>(null);
  const filteredGroups = React.useMemo(
    () => filterLabTrendGroups(data.trendGroups, { timeRange, searchTerm, onlyAbnormal }),
    [data.trendGroups, onlyAbnormal, searchTerm, timeRange]
  );
  const totalVariables = React.useMemo(
    () => countLabTrendVariables(data.trendGroups),
    [data.trendGroups]
  );
  const visibleVariables = React.useMemo(
    () => countLabTrendVariables(filteredGroups),
    [filteredGroups]
  );
  const focusResults = React.useMemo(
    () => collectLabTrendFocusResults(filteredGroups, activeDate),
    [activeDate, filteredGroups]
  );

  if (data.trendGroups.length === 0) {
    return (
      <div className="py-8 text-center">
        <TrendingUp size={28} className="mx-auto mb-2 text-slate-200" />
        <p className="text-[12px] text-slate-400">
          Se necesitan al menos 2 examenes con la misma variable para generar tendencias.
        </p>
      </div>
    );
  }

  return (
    <div>
      <LabTrendToolbar
        timeRange={timeRange}
        searchTerm={searchTerm}
        onlyAbnormal={onlyAbnormal}
        visibleVariables={visibleVariables}
        totalVariables={totalVariables}
        onTimeRangeChange={range => {
          setTimeRange(range);
          setActiveDate(null);
        }}
        onSearchTermChange={value => {
          setSearchTerm(value);
          setActiveDate(null);
        }}
        onOnlyAbnormalChange={value => {
          setOnlyAbnormal(value);
          setActiveDate(null);
        }}
      />
      <LabTrendFocusStrip activeDate={activeDate} results={focusResults} />
      {filteredGroups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
          <SearchX size={26} className="mx-auto mb-2 text-slate-300" />
          <p className="text-[12px] font-semibold text-slate-600">
            No hay tendencias para estos filtros.
          </p>
          <button
            type="button"
            onClick={() => {
              setTimeRange('all');
              setSearchTerm('');
              setOnlyAbnormal(false);
            }}
            className="mt-2 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
          >
            Mostrar todas
          </button>
        </div>
      ) : (
        <div ref={resolvedChartsRef} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filteredGroups.map(group => (
            <LabChartErrorBoundary key={group.label} chartLabel={group.label}>
              <LabTrendGroupCard
                group={group}
                syncId="lab-trend-time"
                onActiveDateChange={setActiveDate}
              />
            </LabChartErrorBoundary>
          ))}
        </div>
      )}
    </div>
  );
};
