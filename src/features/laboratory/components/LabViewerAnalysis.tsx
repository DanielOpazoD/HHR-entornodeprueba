/**
 * @module LabViewerAnalysis
 * @description Analysis container with trend/comparison tabs and clipboard copy.
 */

import React from 'react';
import clsx from 'clsx';
import { ArrowLeft, BarChart3, Check, Clipboard, FlaskConical, TrendingUp } from 'lucide-react';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import type { LabPatient, SyslabExamItem } from '@/types/domain/labExamTypes';
import type { LabAnalysisData, AnalysisViewTab } from '@/types/domain/labAnalyticsTypes';
import { buildLabSummaryText } from '../controllers/labSummaryController';
import { LabViewerTrendCharts } from './LabViewerTrendCharts';
import { LabViewerComparisonTable } from './LabViewerComparisonTable';
import { LabViewerMicrobiologyPanel } from './LabViewerMicrobiologyPanel';

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

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700"
          >
            <ArrowLeft size={14} />
            Volver a lista de examenes
          </button>
          <span className="hidden h-4 w-px bg-slate-200 sm:inline-block" />
          <h2 className="min-w-0 truncate text-[15px] font-bold text-slate-800">
            {patient?.patientName || 'Paciente seleccionado'}
          </h2>
          {patient?.rut ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              RUT {patient.rut}
            </span>
          ) : null}
          <span className="text-[11px] font-medium text-slate-500">
            {data.examDates.length} examenes · {Object.keys(data.comparison).length} variables
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopyToClipboard}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-[10px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
        >
          {copied ? <Check size={11} className="text-emerald-500" /> : <Clipboard size={11} />}
          {copied ? 'Copiado' : 'Copiar resumen'}
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200 pb-0">
        {TAB_CONFIG.filter(
          tab => tab.key !== 'microbiology' || data.microbiologyEntries.length > 0
        ).map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={clsx(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-all border-b-2 -mb-px',
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

      {activeTab === 'trends' && <LabViewerTrendCharts data={data} />}
      {activeTab === 'comparison' && <LabViewerComparisonTable data={data} patient={patient} />}
      {activeTab === 'microbiology' && (
        <LabViewerMicrobiologyPanel entries={data.microbiologyEntries} onOpenPdf={onOpenPdf} />
      )}
    </div>
  );
};
