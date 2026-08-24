/**
 * @module LabViewerAnalysis
 * @description Analysis container with trend/comparison tabs and clipboard copy.
 */

import React from 'react';
import clsx from 'clsx';
import {
  ArrowLeft,
  BarChart3,
  Check,
  Clipboard,
  Download,
  FlaskConical,
  LoaderCircle,
  TrendingUp,
} from 'lucide-react';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import type { LabPatient, SyslabExamItem } from '@/types/domain/labExamTypes';
import type { LabAnalysisData, AnalysisViewTab } from '@/types/domain/labAnalyticsTypes';
import { buildLabSummaryText } from '../controllers/labSummaryController';
import { LabViewerTrendCharts } from './LabViewerTrendCharts';
import { LabViewerComparisonTable } from './LabViewerComparisonTable';
import { LabViewerMicrobiologyPanel } from './LabViewerMicrobiologyPanel';
import { exportChartsAsPng } from './labTrendChartExport';

interface LabViewerAnalysisProps {
  data: LabAnalysisData;
  patient: LabPatient | null;
  activeTab: AnalysisViewTab;
  onTabChange: (tab: AnalysisViewTab) => void;
  onBack: () => void;
  onOpenPdf: (exam: SyslabExamItem) => void;
}

// TAB_CONFIG stays in this component (not in labConstants) because it contains JSX icon elements.
const TAB_CONFIG: { key: AnalysisViewTab; label: string; icon: React.ReactNode }[] = [
  { key: 'trends', label: 'Tendencias', icon: <TrendingUp size={13} /> },
  { key: 'comparison', label: 'Comparacion', icon: <BarChart3 size={13} /> },
  { key: 'microbiology', label: 'Microbiología', icon: <FlaskConical size={13} /> },
];

export const LabViewerAnalysis: React.FC<LabViewerAnalysisProps> = ({
  data,
  patient,
  activeTab,
  onTabChange,
  onBack,
  onOpenPdf,
}) => {
  const [copied, setCopied] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const chartsRef = React.useRef<HTMLDivElement>(null);
  const copiedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    []
  );

  const handleCopyToClipboard = async () => {
    // Build summary text for each exam date using comparison data
    const lines: string[] = [];
    for (const dateKey of data.examDates) {
      const findings = Object.entries(data.comparison)
        .filter(([, dateMap]) => dateMap[dateKey])
        .map(([, dateMap]) => dateMap[dateKey]);
      if (findings.length === 0) continue;
      const datePart = dateKey.substring(0, 10);
      const timePart = dateKey.substring(11) || '00:00';
      const text = buildLabSummaryText(findings, datePart, timePart);
      if (text) lines.push(text);
    }
    if (lines.length === 0) return;
    await writeClipboardText(lines.join('\n'));
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const handleExportCharts = async () => {
    if (!chartsRef.current) {
      setExportError('No hay gráficos visibles para descargar.');
      return;
    }
    setIsExporting(true);
    setExportError(null);
    try {
      await exportChartsAsPng(chartsRef.current);
    } catch {
      setExportError('No se pudo descargar PNG.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      <div
        data-testid="lab-analysis-sticky-header"
        className="sticky top-0 z-20 -mx-5 -mt-3 mb-3 border-b border-slate-200 bg-white/95 px-5 pt-2 shadow-[0_8px_18px_-18px_rgba(15,23,42,0.65)] backdrop-blur"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-7 items-center gap-1 rounded-md pr-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50 hover:text-emerald-800"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Volver a exámenes
            </button>
            <span className="hidden h-4 w-px bg-slate-200 sm:inline-block" />
            <h2 className="min-w-0 truncate text-[15px] font-bold tracking-tight text-slate-900">
              {patient?.patientName || 'Paciente seleccionado'}
            </h2>
            {patient?.rut ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                RUT {patient.rut}
              </span>
            ) : null}
            <span className="text-[11px] font-medium text-slate-500">
              {data.examDates.length} exámenes · {Object.keys(data.comparison).length} variables
            </span>
          </div>

          <div className="inline-flex h-8 shrink-0 items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 shadow-sm">
            <button
              type="button"
              onClick={handleCopyToClipboard}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-semibold text-slate-700 transition hover:bg-white hover:text-emerald-700"
            >
              {copied ? (
                <Check size={12} aria-hidden="true" className="text-emerald-500" />
              ) : (
                <Clipboard size={12} aria-hidden="true" />
              )}
              {copied ? 'Copiado' : 'Copiar resumen'}
            </button>
            {activeTab === 'trends' ? (
              <>
                <span className="h-4 w-px bg-slate-200" />
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={handleExportCharts}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-semibold text-slate-700 transition hover:bg-white hover:text-emerald-700 disabled:opacity-50"
                >
                  {isExporting ? (
                    <LoaderCircle size={12} aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Download size={12} aria-hidden="true" />
                  )}
                  {isExporting ? 'Exportando' : 'Descargar PNG'}
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {TAB_CONFIG.filter(
            tab => tab.key !== 'microbiology' || data.microbiologyEntries.length > 0
          ).map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={clsx(
                '-mb-px inline-flex h-8 items-center gap-1.5 border-b-2 px-3 text-[11px] font-semibold transition-all',
                activeTab === tab.key
                  ? 'border-emerald-500 text-emerald-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {exportError ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700"
        >
          {exportError}
        </p>
      ) : null}

      {activeTab === 'trends' && <LabViewerTrendCharts data={data} chartsRef={chartsRef} />}
      {activeTab === 'comparison' && <LabViewerComparisonTable data={data} patient={patient} />}
      {activeTab === 'microbiology' && (
        <LabViewerMicrobiologyPanel entries={data.microbiologyEntries} onOpenPdf={onOpenPdf} />
      )}
    </div>
  );
};
