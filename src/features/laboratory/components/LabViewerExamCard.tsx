import React from 'react';
import clsx from 'clsx';
import { Check, Clipboard, FileText } from 'lucide-react';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';

interface LabViewerExamCardProps {
  exam: SyslabExamItem;
  isSelected: boolean;
  copiedExamId: string | null;
  copyingExamId: string | null;
  onToggleSelect: (id: string) => void;
  onViewPdf: (exam: SyslabExamItem) => void;
  onCopySummary: (exam: SyslabExamItem) => void;
}

export const LabViewerExamCard: React.FC<LabViewerExamCardProps> = ({
  exam,
  isSelected,
  copiedExamId,
  copyingExamId,
  onToggleSelect,
  onViewPdf,
  onCopySummary,
}) => (
  <div
    data-testid={`lab-exam-card-${exam.id}`}
    className={clsx(
      'flex items-start gap-2.5 rounded-md border bg-white px-3 py-2 transition-colors',
      isSelected
        ? 'border-emerald-300 shadow-[inset_3px_0_0_#059669] ring-1 ring-emerald-200/70'
        : 'border-slate-200/70 bg-white hover:bg-slate-50/50'
    )}
  >
    {exam.link ? (
      <button
        type="button"
        role="checkbox"
        aria-checked={isSelected}
        aria-label={`Seleccionar examen ${exam.id}`}
        onClick={() => onToggleSelect(exam.id)}
        className={clsx(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/20',
          isSelected
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-slate-300 bg-white text-transparent hover:border-emerald-400'
        )}
      >
        <Check size={12} strokeWidth={3} />
      </button>
    ) : null}
    <div className="flex-1 min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[15px] font-bold text-slate-800">{exam.date}</span>
        {exam.time ? (
          <span className="text-[11px] font-medium text-slate-400">{exam.time}</span>
        ) : null}
        <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
          #{exam.id}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {exam.exams.map((name, index) => (
          <span
            key={`${exam.id}-${index}-${name}`}
            className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[9px] font-medium text-slate-600"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
    {exam.link ? (
      <div className="shrink-0 flex min-w-[116px] flex-col items-stretch gap-1">
        <button
          type="button"
          onClick={() => onViewPdf(exam)}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 hover:text-emerald-800"
        >
          <FileText size={12} />
          Ver PDF
        </button>
        <button
          type="button"
          onClick={() => onCopySummary(exam)}
          disabled={copyingExamId === exam.id}
          aria-label={`Copiar resumen del examen ${exam.id}`}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent px-2 py-0.5 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
        >
          {copiedExamId === exam.id ? (
            <Check size={12} className="text-emerald-600" />
          ) : (
            <Clipboard size={12} />
          )}
          {copiedExamId === exam.id
            ? 'Copiado'
            : copyingExamId === exam.id
              ? 'Copiando…'
              : 'Copiar resumen'}
        </button>
      </div>
    ) : null}
  </div>
);
