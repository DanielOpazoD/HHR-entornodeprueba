import React from 'react';
import {
  List,
  Rows3,
  Box,
  Boxes,
  FileDown,
  Download,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import { AuditLogEntry, GroupedAuditLogEntry } from '@/types/auditLogTypes';
import { AuditLogRow } from './AuditLogRow';
import { PatientAuditPackageRow } from './PatientAuditPackageRow';
import {
  AuditPatientPackageIntentTabs,
  buildPatientPackageIntentTabId,
} from './AuditPatientPackageIntentTabs';
import {
  AuditTableEmptyState,
  AuditTableLoadingState,
  AuditWindowStatus,
} from './AuditTableOperationalState';
import type { ClinicalAuditPatientPackage } from '@/services/admin/clinicalAuditPatientPackages';
import type {
  ClinicalAuditPatientPackageFilterId,
  ClinicalAuditPatientPackageFilterOption,
  ClinicalAuditPatientPackageIntentId,
  ClinicalAuditPatientPackageIntentOption,
} from '@/services/admin/clinicalAuditPatientPackageFilters';

interface AuditTableProps {
  filteredLogs: AuditLogEntry[];
  displayLogsCount: number;
  paginatedLogs: (AuditLogEntry | GroupedAuditLogEntry)[];
  patientPackages: ClinicalAuditPatientPackage[];
  paginatedPatientPackages: ClinicalAuditPatientPackage[];
  patientPackageFilterOptions: ClinicalAuditPatientPackageFilterOption[];
  patientPackageIntentOptions: ClinicalAuditPatientPackageIntentOption[];
  activePatientPackageFilter: ClinicalAuditPatientPackageFilterId;
  onPatientPackageFilterChange: (value: ClinicalAuditPatientPackageFilterId) => void;
  activePatientPackageIntent: ClinicalAuditPatientPackageIntentId;
  onPatientPackageIntentChange: (value: ClinicalAuditPatientPackageIntentId) => void;
  loading: boolean;
  compactView: boolean;
  setCompactView: (val: boolean) => void;
  groupedView: boolean;
  setGroupedView: (val: boolean) => void;
  expandedRows: Set<string>;
  toggleRow: (id: string) => void;
  onPdfExport: () => void;
  onExcelExport: () => void;
  isExporting: boolean;
  fetchLimit: number;
  canLoadMoreLogs: boolean;
  onLoadMoreLogs: () => void;
  // Pagination
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  itemsPerPage: number;
}

export const AuditTable: React.FC<AuditTableProps> = ({
  filteredLogs,
  displayLogsCount,
  paginatedLogs,
  patientPackages,
  paginatedPatientPackages,
  patientPackageFilterOptions,
  patientPackageIntentOptions,
  activePatientPackageFilter,
  onPatientPackageFilterChange,
  activePatientPackageIntent,
  onPatientPackageIntentChange,
  loading,
  compactView,
  setCompactView,
  groupedView,
  setGroupedView,
  expandedRows,
  toggleRow,
  onPdfExport,
  onExcelExport,
  isExporting,
  fetchLimit,
  canLoadMoreLogs,
  onLoadMoreLogs,
  currentPage,
  totalPages,
  onPageChange,
  itemsPerPage,
}) => {
  const isPatientPackageView = groupedView;
  const tableColSpan = isPatientPackageView ? (compactView ? 4 : 6) : compactView ? 4 : 7;
  const totalDisplayItems = isPatientPackageView ? patientPackages.length : filteredLogs.length;
  const hasVisibleRows = isPatientPackageView
    ? patientPackages.length > 0
    : filteredLogs.length > 0;
  const emptyStateTitle = isPatientPackageView
    ? 'No hay paquetes por paciente para esta combinación'
    : 'No se encontraron rastros para los filtros aplicados';
  const emptyStateDetail = canLoadMoreLogs
    ? 'Amplía la ventana de auditoría para buscar en registros anteriores.'
    : 'Ajusta filtros, fecha o vista para ampliar el resultado visible.';
  const patientPackagePanelId = React.useId();
  const patientPackageTabsId = React.useId();
  const activeIntentTabId = buildPatientPackageIntentTabId(
    patientPackageTabsId,
    activePatientPackageIntent
  );

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Table Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/30">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-500">
            {filteredLogs.length} registros
            {isPatientPackageView
              ? ` / ${patientPackages.length} paquetes por paciente`
              : groupedView && displayLogsCount < filteredLogs.length
                ? ` / ${displayLogsCount} entradas visibles`
                : ''}
            {` / ventana ${fetchLimit}`}
          </span>
          {/* Compact View Toggle */}
          <button
            type="button"
            aria-pressed={compactView}
            onClick={() => setCompactView(!compactView)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
              compactView
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            )}
            title={compactView ? 'Vista normal' : 'Vista compacta'}
          >
            {compactView ? <List size={14} /> : <Rows3 size={14} />}
            {compactView ? 'Compacto' : 'Normal'}
          </button>
          {/* Grouped View Toggle */}
          <button
            type="button"
            aria-pressed={groupedView}
            onClick={() => setGroupedView(!groupedView)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
              groupedView
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            )}
            title={groupedView ? 'Ver eventos crudos' : 'Agrupar por paciente'}
          >
            {groupedView ? <Box size={14} /> : <Boxes size={14} />}
            {groupedView ? 'Vista paciente' : 'Eventos crudos'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {canLoadMoreLogs && (
            <button
              type="button"
              onClick={onLoadMoreLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-all"
              title="Ampliar historial de auditoria"
            >
              <Rows3 size={14} />
              Cargar más registros de auditoría
            </button>
          )}
          {!loading && !canLoadMoreLogs && <AuditWindowStatus fetchLimit={fetchLimit} />}
          {/* PDF Export Button */}
          <button
            type="button"
            onClick={onPdfExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-all"
          >
            <FileDown size={14} />
            PDF
          </button>
          {/* Excel Export Button */}
          <button
            type="button"
            onClick={onExcelExport}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all disabled:opacity-50"
          >
            <Download size={14} />
            Excel
          </button>
        </div>
      </div>

      {isPatientPackageView && (
        <div className="border-b border-slate-100 bg-white">
          <AuditPatientPackageIntentTabs
            options={patientPackageIntentOptions}
            activeIntent={activePatientPackageIntent}
            onIntentChange={onPatientPackageIntentChange}
            panelId={patientPackagePanelId}
            tabsId={patientPackageTabsId}
          />

          <div
            className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-2"
            aria-label="Filtros operacionales de paquetes por paciente"
          >
            {patientPackageFilterOptions.map(option => {
              const isActive = activePatientPackageFilter === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-label={`${option.label} ${option.count}`}
                  aria-pressed={isActive}
                  onClick={() => onPatientPackageFilterChange(option.id)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-bold transition focus:outline-none focus:ring-4',
                    isActive
                      ? 'border-sky-200 bg-sky-50 text-sky-700 focus:ring-sky-500/15'
                      : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 focus:ring-slate-500/10'
                  )}
                >
                  <span>{option.label}</span>
                  <span
                    className={clsx(
                      'rounded-md px-1.5 py-0.5 font-black',
                      isActive ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600'
                    )}
                  >
                    {option.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div
        className="overflow-x-auto"
        id={isPatientPackageView ? patientPackagePanelId : undefined}
        role={isPatientPackageView ? 'tabpanel' : undefined}
        aria-labelledby={isPatientPackageView ? activeIntentTabId : undefined}
      >
        <table className="w-full text-sm">
          <thead className="bg-slate-50/50 border-b border-slate-100">
            {isPatientPackageView ? (
              <tr className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                <th className="px-5 py-3 text-left w-6"></th>
                <th className="px-3 py-3 text-left">Censo / momento</th>
                <th className="px-3 py-3 text-left">Paciente</th>
                <th className="px-3 py-3 text-left">Cambios visibles</th>
                {!compactView && <th className="px-3 py-3 text-left">Responsable</th>}
                {!compactView && <th className="px-3 py-3 text-left">Trazabilidad</th>}
              </tr>
            ) : (
              <tr className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                <th className="px-6 py-4 text-left w-6"></th>
                <th className="px-4 py-4 text-left">Momento</th>
                <th className="px-4 py-4 text-left">Responsable</th>
                {!compactView && <th className="px-4 py-4 text-left">Evento clínico</th>}
                <th className="px-4 py-4 text-left">Relato clínico</th>
                {!compactView && <th className="px-4 py-4 text-left">Afectado</th>}
                {!compactView && <th className="px-4 py-4 text-left">Origen</th>}
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <AuditTableLoadingState colSpan={tableColSpan} />
            ) : !hasVisibleRows ? (
              <AuditTableEmptyState
                colSpan={tableColSpan}
                title={emptyStateTitle}
                detail={emptyStateDetail}
              />
            ) : isPatientPackageView ? (
              paginatedPatientPackages.map(auditPackage => (
                <PatientAuditPackageRow
                  key={auditPackage.id}
                  auditPackage={auditPackage}
                  isExpanded={expandedRows.has(auditPackage.id)}
                  onToggle={() => toggleRow(auditPackage.id)}
                  compactView={compactView}
                />
              ))
            ) : (
              paginatedLogs.map(log => (
                <AuditLogRow
                  key={log.id}
                  log={log}
                  isExpanded={expandedRows.has(log.id)}
                  onToggle={() => toggleRow(log.id)}
                  compactView={compactView}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/30">
          <span className="text-xs text-slate-500">
            Mostrando {(currentPage - 1) * itemsPerPage + 1} -{' '}
            {Math.min(currentPage * itemsPerPage, totalDisplayItems)} de {totalDisplayItems}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    type="button"
                    aria-current={currentPage === pageNum ? 'page' : undefined}
                    onClick={() => onPageChange(pageNum)}
                    className={clsx(
                      'w-8 h-8 rounded-lg text-xs font-medium transition-all',
                      currentPage === pageNum
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white border border-slate-200 hover:bg-slate-100'
                    )}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
