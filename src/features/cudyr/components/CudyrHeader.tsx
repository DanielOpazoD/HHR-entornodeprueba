/**
 * CudyrHeader
 *
 * Top section of the CUDYR view with clear visual hierarchy:
 *  1. Title row — instrument name + date, prominent back button
 *  2. Stats bar — occupancy metrics, non-zero category pills, actions
 */

import React, { useState } from 'react';
import { ArrowLeft, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { PdfViewerModal } from '@/components/shared/PdfViewerModal';
import { formatTimeHHMM } from '@/utils/dateDisplayUtils';
import { cudyrExportLogger } from '@/services/cudyr/cudyrLoggers';
import { useNotification } from '@/context/UIContext';
import type { CategoryCounts, CudyrCategory } from '@/services/cudyr/cudyrSummary';
import type { DailyRecordCudyrExportState } from '@/services/contracts/dailyRecordServiceContracts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CUDYR_INSTRUMENT_PDF_PATH = '/docs/instrumento-cudyr.pdf';

const ALL_CATEGORIES: CudyrCategory[] = [
  'A1',
  'A2',
  'A3',
  'B1',
  'B2',
  'B3',
  'C1',
  'C2',
  'C3',
  'D1',
  'D2',
  'D3',
];

const CATEGORY_COLORS: Record<string, string> = {
  A: 'bg-rose-100 text-rose-700 border-rose-200',
  B: 'bg-amber-100 text-amber-700 border-amber-200',
  C: 'bg-sky-100 text-sky-700 border-sky-200',
  D: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CudyrHeaderProps {
  occupiedCount: number;
  categorizedCount: number;
  currentDate?: string;
  updatedAt?: string;
  /** Category counts by bed type (UTI + Media combined for display). */
  categoryCounts?: CategoryCounts;
  currentRecord?: DailyRecordCudyrExportState | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatHeaderDate = (dateString?: string): string => {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-');
  if (!year || !month || !day) return dateString;
  return `${day}-${month}-${year}`;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CudyrHeader: React.FC<CudyrHeaderProps> = ({
  occupiedCount,
  categorizedCount,
  currentDate,
  updatedAt,
  categoryCounts,
  currentRecord,
}) => {
  const { error: notifyError } = useNotification();
  const [isExporting, setIsExporting] = useState(false);
  const [isInstrumentOpen, setIsInstrumentOpen] = useState(false);

  const categorizationIndex =
    occupiedCount > 0 ? Math.round((categorizedCount / occupiedCount) * 100) : 0;

  const handleExportExcel = async () => {
    if (!currentDate || isExporting) return;
    setIsExporting(true);
    try {
      const [year, month] = currentDate.split('-').map(Number);
      const { generateCudyrMonthlyExcel } = await import('@/services/cudyr/cudyrExportService');
      const result = await generateCudyrMonthlyExcel(year, month, currentDate, currentRecord);
      if (result.outcome === 'failed') {
        cudyrExportLogger.error(`Monthly CUDYR Excel rejected by validation: ${result.reason}`);
        notifyError('No se pudo generar el Excel CUDYR', result.userSafeMessage);
      }
    } catch (error) {
      cudyrExportLogger.error('Error exporting monthly CUDYR Excel', error);
      notifyError(
        'Error al exportar CUDYR',
        'No fue posible exportar el resumen mensual. Por favor intenta nuevamente.'
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleBackToNightShift = () => {
    window.dispatchEvent(new CustomEvent('navigate-module', { detail: 'NURSING_HANDOFF' }));
    window.dispatchEvent(new CustomEvent('set-shift', { detail: 'night' }));
  };

  // Merge UTI + Media counts for the combined category display
  const mergedCategoryCounts: Record<CudyrCategory, number> | null = categoryCounts
    ? (Object.fromEntries(
        ALL_CATEGORIES.map(cat => [
          cat,
          (categoryCounts.uti[cat] || 0) + (categoryCounts.media[cat] || 0),
        ])
      ) as Record<CudyrCategory, number>)
    : null;

  const nonZeroCategories = mergedCategoryCounts
    ? ALL_CATEGORIES.filter(cat => mergedCategoryCounts[cat] > 0)
    : [];

  return (
    <>
      {/* ================================================================= */}
      {/* Row 1 — Title + Back button                                       */}
      {/* ================================================================= */}
      <div
        className="mb-3 flex flex-wrap items-center justify-between gap-3"
        data-testid="cudyr-title-row"
      >
        <h2 className="min-w-0 text-lg font-bold text-slate-800">
          Instrumento CUDYR
          {currentDate && (
            <span className="ml-2 text-slate-500 font-semibold">
              {formatHeaderDate(currentDate)}
            </span>
          )}
        </h2>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setIsInstrumentOpen(true)}
            className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
            title="Ver Instrumento CUDYR (PDF)"
          >
            <FileText size={12} />
            Ver Instrumento
          </button>

          {currentDate && (
            <button
              onClick={handleExportExcel}
              disabled={isExporting}
              className={clsx(
                'flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold transition-colors',
                isExporting
                  ? 'bg-slate-100 text-slate-400 cursor-wait'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              )}
              title="Exportar resumen mensual CUDYR"
            >
              {isExporting ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Exportando...
                </>
              ) : (
                <>
                  <FileSpreadsheet size={12} />
                  Excel mensual
                </>
              )}
            </button>
          )}

          <button
            onClick={handleBackToNightShift}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
            title="Volver a Entrega de Turno Noche"
          >
            <ArrowLeft size={14} />
            Volver a Turno Noche
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* Row 2 — Stats + Categories + Actions                              */}
      {/* ================================================================= */}
      <div
        className="mb-4 flex flex-col gap-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2"
        data-testid="cudyr-stats-actions-bar"
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* Metrics */}
          <div
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
            data-testid="cudyr-metrics"
          >
            <span className="text-slate-600">
              Ocupadas <b className="text-sm text-slate-800">{occupiedCount}</b>
            </span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600">
              Categorizadas <b className="text-sm text-slate-800">{categorizedCount}</b>
            </span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600">
              Índice{' '}
              <b
                className={clsx(
                  'text-sm',
                  categorizationIndex === 100 ? 'text-emerald-600' : 'text-slate-800'
                )}
              >
                {categorizationIndex}%
              </b>
            </span>
          </div>

          {/* Category pills (non-zero only) */}
          {nonZeroCategories.length > 0 && mergedCategoryCounts && (
            <>
              <span className="text-slate-300">|</span>
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {nonZeroCategories.map(cat => (
                  <span
                    key={cat}
                    className={clsx(
                      'inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-bold',
                      CATEGORY_COLORS[cat[0]]
                    )}
                  >
                    {cat}
                    <span className="opacity-80">{mergedCategoryCounts[cat]}</span>
                  </span>
                ))}
              </div>
            </>
          )}

          <div
            className="flex flex-1 flex-wrap items-center justify-end gap-2"
            data-testid="cudyr-actions"
          >
            {/* Last modified */}
            {updatedAt && (
              <span className="text-[10px] text-slate-400" title={`Última modificación CUDYR`}>
                Últ. mod. {formatTimeHHMM(updatedAt)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* PDF viewer modal */}
      {isInstrumentOpen && (
        <PdfViewerModal
          fileName="Instrumento CUDYR"
          url={CUDYR_INSTRUMENT_PDF_PATH}
          onClose={() => setIsInstrumentOpen(false)}
        />
      )}
    </>
  );
};
