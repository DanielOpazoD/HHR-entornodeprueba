/**
 * @module LabViewerComparisonTable
 * @description Comparison table with dates as columns and lab variables as rows.
 * Adds clinical grouping, lightweight local pinning and quieter visual emphasis.
 */

import React from 'react';
import { X } from 'lucide-react';
import type { LabPatient } from '@/types/domain/labExamTypes';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import type { ExportConfig } from '../types/labViewerTypes';
import type { ComparisonGroupLabel } from '../constants/labComparisonGroupingConstants';
import {
  buildComparisonGroups,
  filterComparisonVariableNames,
  resolveInitialPinnedVariables,
} from '../controllers/labComparisonTableController';
import { formatLabExamColumnLabel } from '../controllers/labFormattingController';
import { LabExportConfigDialog } from './LabExportConfigDialog';
import { LabViewerComparisonTableBody } from './LabViewerComparisonTableBody';
import { LabViewerComparisonToolbar } from './LabViewerComparisonToolbar';

const loadLabExcelExporter = async () =>
  import('../services/labExcelService').then(module => module.exportComparisonToExcel);

export const LabViewerComparisonTable: React.FC<{
  data: LabAnalysisData;
  patient: LabPatient | null;
}> = ({ data, patient }) => {
  const allVariableNames = Object.keys(data.comparison);
  const { examDates } = data;
  const [showExportConfig, setShowExportConfig] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [includeTimeInColumns, setIncludeTimeInColumns] = React.useState(true);
  const [hiddenExamDates, setHiddenExamDates] = React.useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<ComparisonGroupLabel>>(
    new Set()
  );
  const [pinnedVariables, setPinnedVariables] = React.useState<Set<string>>(() =>
    resolveInitialPinnedVariables(allVariableNames)
  );

  const variableNames = React.useMemo(
    () => filterComparisonVariableNames(allVariableNames, searchQuery),
    [allVariableNames, searchQuery]
  );

  const comparisonGroups = React.useMemo(
    () => buildComparisonGroups(variableNames, allVariableNames, pinnedVariables),
    [variableNames, allVariableNames, pinnedVariables]
  );

  const visibleExamDates = React.useMemo(
    () => examDates.filter(date => !hiddenExamDates.has(date)),
    [examDates, hiddenExamDates]
  );

  const toggleGroup = (label: ComparisonGroupLabel) => {
    setCollapsedGroups(current => {
      const next = new Set(current);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const togglePin = (name: string) => {
    setPinnedVariables(current => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const hideColumn = (date: string) => {
    setHiddenExamDates(current => new Set(current).add(date));
  };

  if (allVariableNames.length === 0) {
    return (
      <p className="py-8 text-center text-[12px] text-slate-400">No hay datos para comparar.</p>
    );
  }

  return (
    <div className="space-y-1.5">
      <LabViewerComparisonToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        includeTimeInColumns={includeTimeInColumns}
        onIncludeTimeInColumnsChange={setIncludeTimeInColumns}
        hiddenColumnCount={hiddenExamDates.size}
        onRestoreColumns={() => setHiddenExamDates(new Set())}
        onToggleExportConfig={() => setShowExportConfig(previous => !previous)}
      />

      {showExportConfig ? (
        <LabExportConfigDialog
          dates={visibleExamDates}
          variables={variableNames}
          includeTimeInColumns={includeTimeInColumns}
          onExport={async (config: ExportConfig) => {
            const exportComparisonToExcel = await loadLabExcelExporter();
            await exportComparisonToExcel(data, config, patient);
            setShowExportConfig(false);
          }}
          onCancel={() => setShowExportConfig(false)}
        />
      ) : null}

      <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            <col style={{ width: '156px', minWidth: '156px' }} />
            {visibleExamDates.map(date => (
              <col key={date} style={{ minWidth: includeTimeInColumns ? '88px' : '70px' }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-50">
              <th className="sticky left-0 z-30 border-r border-slate-200 bg-slate-50 px-2 py-1 text-left text-[8px] font-bold uppercase text-slate-500 whitespace-nowrap">
                Variable
              </th>
              {visibleExamDates.map(date => (
                <th
                  key={date}
                  className="px-1 py-1 text-center text-[8px] font-bold text-slate-500 whitespace-nowrap"
                  title={date}
                >
                  <span className="inline-flex items-center justify-center gap-1">
                    {formatLabExamColumnLabel(date, includeTimeInColumns)}
                    <button
                      type="button"
                      onClick={() => hideColumn(date)}
                      title={`Ocultar columna ${date}`}
                      className="inline-flex h-4 w-4 items-center justify-center rounded text-slate-300 transition-colors hover:bg-slate-200 hover:text-slate-600"
                    >
                      <X size={10} />
                    </button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <LabViewerComparisonTableBody
            comparisonGroups={comparisonGroups}
            examDates={visibleExamDates}
            data={data}
            collapsedGroups={collapsedGroups}
            pinnedVariables={pinnedVariables}
            onToggleGroup={toggleGroup}
            onTogglePin={togglePin}
          />
        </table>
      </div>
    </div>
  );
};
