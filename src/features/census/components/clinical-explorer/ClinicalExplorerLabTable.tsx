import React, { lazy, Suspense, useState } from 'react';
import { FileText } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import {
  buildComparisonGroups,
  comparisonSortIndex,
} from '@/features/laboratory/hospitalization-reports';
import { formatLabResult } from '@/features/laboratory';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';
import { buildRecentLabColumns } from './clinicalExplorerLabModel';

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
  const columns = buildRecentLabColumns(analysis, exams, day);
  const names = Object.keys(analysis.comparison)
    .filter(name => columns.some(column => analysis.comparison[name][column.key]))
    .sort((a, b) => comparisonSortIndex(a) - comparisonSortIndex(b) || a.localeCompare(b, 'es'));
  const groups = buildComparisonGroups(names, names, new Set());
  return (
    <>
      <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-200/80">
        <table className="w-full min-w-[660px] border-collapse text-[12px]">
          <caption className="border-b border-slate-100 bg-slate-50/60 px-3 py-2 text-left text-[11px] text-slate-500">
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
                  <span className="inline-flex items-center justify-end gap-1">
                    {formatDateDDMMYYYY(column.dayIso)}
                    {column.exam?.link && (
                      <button
                        type="button"
                        onClick={() => setOpened({ scope, exam: column.exam! })}
                        aria-label={`Abrir PDF del informe ${column.exam.id} del ${formatDateDDMMYYYY(column.dayIso)}`}
                        title="Abrir PDF original"
                        className="inline-flex size-7 items-center justify-center rounded text-slate-400 hover:bg-white hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
                      >
                        <FileText size={13} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                  {columns.filter(other => other.dayIso === column.dayIso).length > 1 && (
                    <span className="block text-[10px] font-normal text-slate-400">
                      Informe {column.exam?.id || index + 1}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map(group => (
            <tbody key={group.label}>
              <tr>
                <th
                  colSpan={columns.length + 1}
                  scope="rowgroup"
                  className="border-y border-slate-100 bg-slate-50/40 px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  {group.label}
                </th>
              </tr>
              {group.rows.map(name => {
                const cells = columns.map(column => analysis.comparison[name][column.key]);
                const units = new Set(
                  cells
                    .filter(Boolean)
                    .map(row => formatLabResult(row.result, row.unit).displayUnit || row.unit)
                );
                const references = new Set(cells.filter(Boolean).map(row => row.refValue));
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
                    {cells.map((row, index) => (
                      <td
                        key={columns[index].key}
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
                    ))}
                  </tr>
                );
              })}
            </tbody>
          ))}
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
