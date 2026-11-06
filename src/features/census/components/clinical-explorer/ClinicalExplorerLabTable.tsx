import React, { lazy, Suspense, useState } from 'react';
import { FileText, Search, X } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import {
  buildComparisonGroups,
  comparisonSortIndex,
} from '@/features/laboratory/hospitalization-reports';
import { formatLabResult } from '@/features/laboratory';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import type { LabResultRow, SyslabExamItem } from '@/types/domain/labExamTypes';
import { buildRecentLabColumns } from './clinicalExplorerLabModel';

const searchText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
    .trim();

const ReportPdf = lazy(() => import('@/features/laboratory/report-pdf'));

/** Six original reports, newest first. Missing measurements stay missing; never carry forward. */
export const ClinicalExplorerLabTable = ({
  analysis,
  exams,
  day,
  identity,
}: {
  analysis: LabAnalysisData;
  exams: SyslabExamItem[];
  day: string;
  identity: string;
}) => {
  const epoch = useSessionEpoch();
  const scope = `${epoch}:${identity}`;
  const [opened, setOpened] = useState<{ scope: string; exam: SyslabExamItem } | null>(null);
  if (opened && opened.scope !== scope) setOpened(null);
  const pdf = opened?.scope === scope ? opened.exam : null;
  const [filter, setFilter] = useState({ scope, query: '' });
  if (filter.scope !== scope) setFilter({ scope, query: '' });
  const query = filter.scope === scope ? filter.query : '';
  const search = searchText(query);
  const columns = buildRecentLabColumns(analysis, exams, day);
  const names = Object.keys(analysis.comparison)
    .filter(name => searchText(name).includes(search))
    .filter(name => columns.some(column => analysis.comparison[name]?.[column.key]))
    .sort((a, b) => comparisonSortIndex(a) - comparisonSortIndex(b) || a.localeCompare(b, 'es'));
  const groups = buildComparisonGroups(names, names, new Set());
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search
            size={13}
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-2.5 text-slate-400"
          />
          <input
            type="search"
            aria-label="Buscar examen de laboratorio"
            placeholder="Buscar examen…"
            value={query}
            onChange={event => setFilter({ scope, query: event.target.value })}
            className="h-8 w-full rounded-md border border-slate-200 bg-white pl-7 pr-8 text-[12px] text-slate-700 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Limpiar búsqueda de exámenes"
              onClick={() => setFilter({ scope, query: '' })}
              className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded text-slate-400 hover:bg-slate-50 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-slate-400">Más reciente primero</span>
      </div>
      <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-200/80">
        <table className="w-full min-w-[660px] border-collapse text-[12px]">
          <caption className="sr-only">
            Últimos {columns.length} informes disponibles · más reciente primero
          </caption>
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-50/70">
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-[170px] bg-slate-50 px-3 py-2 text-left font-medium text-slate-500"
              >
                Examen
              </th>
              {columns.map((column, index) => (
                <th
                  scope="col"
                  key={column.key}
                  className={`min-w-[82px] px-2 py-2 text-right font-medium tabular-nums ${index === 0 ? 'bg-teal-50/60 text-teal-900' : 'text-slate-600'}`}
                >
                  <span className="block whitespace-nowrap text-[11px]">
                    {formatDateDDMMYYYY(column.dayIso)}
                  </span>
                  <span className="flex min-h-6 items-center justify-end gap-1">
                    <span
                      className="text-[9px] font-normal text-slate-400"
                      title="Hora informada por Syslab"
                    >
                      {column.exam?.time || column.time || '—'}
                    </span>
                    {column.exam?.link && (
                      <button
                        type="button"
                        onClick={() => {
                          if (column.exam) setOpened({ scope, exam: column.exam });
                        }}
                        aria-label={`Abrir PDF del informe ${column.exam.id} del ${formatDateDDMMYYYY(column.dayIso)}`}
                        title={`Abrir PDF original · Informe ${column.exam.id}`}
                        className="inline-flex size-6 items-center justify-center rounded text-slate-400 hover:bg-white hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
                      >
                        <FileText size={13} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups
              .flatMap(group => group.rows)
              .map(name => {
                const cells = columns.map(column => analysis.comparison[name]?.[column.key]);
                const units = new Set(
                  cells
                    .filter((row): row is LabResultRow => row !== undefined)
                    .map(row => formatLabResult(row.result, row.unit).displayUnit || row.unit)
                );
                const references = new Set(
                  cells
                    .filter((row): row is LabResultRow => row !== undefined)
                    .map(row => row.refValue)
                );
                const commonReference =
                  units.size <= 1 && references.size === 1 ? [...references][0] : null;
                return (
                  <tr
                    key={name}
                    className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-slate-700"
                    >
                      {name}
                      {units.size === 1 && (
                        <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                          {[...units][0]}
                        </span>
                      )}
                      {commonReference && (
                        <span className="block text-[10px] font-normal text-slate-400">
                          Ref. {commonReference}
                        </span>
                      )}
                    </th>
                    {columns.map((column, index) => {
                      const row = cells[index];
                      return (
                        <td
                          key={column.key}
                          className={`px-2 py-2 text-right tabular-nums ${index === 0 ? 'bg-teal-50/20 font-semibold text-slate-900' : 'text-slate-600'}`}
                          title={
                            row
                              ? `${row.result} ${row.unit}${row.refValue ? ` · Referencia: ${row.refValue}` : ''}`
                              : 'No informado en esta toma'
                          }
                        >
                          {row ? (
                            <>
                              {formatLabResult(row.result, row.unit).display}
                              {!commonReference && row.refValue && (
                                <span className="block text-[10px] font-normal text-slate-400">
                                  Ref. {row.refValue}
                                </span>
                              )}
                              {units.size > 1 && (
                                <span className="block text-[10px] font-normal text-slate-400">
                                  {formatLabResult(row.result, row.unit).displayUnit || row.unit}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            {names.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-6 text-center text-[12px] text-slate-500"
                >
                  <p role="status">
                    {search
                      ? 'Sin exámenes que coincidan con la búsqueda.'
                      : 'Sin resultados en estos informes.'}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pdf && (
        <BaseModal
          isOpen
          onClose={() => setOpened(null)}
          title={`Informe de laboratorio · ${pdf.date}`}
          size="xl"
        >
          <Suspense fallback={<p role="status">Abriendo PDF…</p>}>
            <ReportPdf key={pdf.link} exam={pdf} onBack={() => setOpened(null)} />
          </Suspense>
        </BaseModal>
      )}
    </>
  );
};
