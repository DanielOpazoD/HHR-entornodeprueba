import React from 'react';
import { Download, Loader2 } from 'lucide-react';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';
import { useTransientFlag } from '@/hooks/useTransientFlag';
import {
  resolveAllSelectableExamsSelected,
  resolveLabExamDateRange,
  resolveSelectableLabExams,
} from '../controllers/labExamListController';
import { LabViewerExamCard } from './LabViewerExamCard';
import { LabViewerExamFilters } from './LabViewerExamFilters';

interface LabViewerExamListProps {
  exams: SyslabExamItem[];
  selectedIds: Set<string>;
  filterCategories: string[];
  activeFilter: string | null;
  onFilterChange: (category: string | null) => void;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onSelectByDays: (days: number) => void;
  onSelectByDateRange: (from: Date, to: Date) => void;
  onViewPdf: (exam: SyslabExamItem) => void;
  onCopySummary: (exam: SyslabExamItem) => Promise<boolean>;
  isDownloadingSelectedPdfs: boolean;
  onDownloadSelectedPdfs: () => Promise<void>;
}

export const LabViewerExamList: React.FC<LabViewerExamListProps> = ({
  exams,
  selectedIds,
  filterCategories,
  activeFilter,
  onFilterChange,
  onToggleSelect,
  onSelectAll,
  onSelectByDays,
  onSelectByDateRange,
  onViewPdf,
  onCopySummary,
  isDownloadingSelectedPdfs,
  onDownloadSelectedPdfs,
}) => {
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [copiedExamId, flashCopiedExamId] = useTransientFlag<string | null>(null, 2000);
  const [copyingExamId, setCopyingExamId] = React.useState<string | null>(null);

  const selectableExams = resolveSelectableLabExams(exams);
  const allSelected = resolveAllSelectableExamsSelected(exams, selectedIds);

  const handleDateRangeSelect = () => {
    const range = resolveLabExamDateRange(dateFrom, dateTo);
    if (!range) return;
    onSelectByDateRange(range.from, range.to);
  };

  const handleCopySummary = async (exam: SyslabExamItem) => {
    setCopyingExamId(exam.id);
    const copied = await onCopySummary(exam);
    setCopyingExamId(null);
    if (!copied) return;
    flashCopiedExamId(exam.id);
  };

  return (
    <div className="space-y-2 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onDownloadSelectedPdfs()}
            disabled={selectedIds.size === 0 || isDownloadingSelectedPdfs}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-bold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
            aria-label="Descargar exámenes seleccionados en un único PDF"
          >
            {isDownloadingSelectedPdfs ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            {isDownloadingSelectedPdfs ? 'Preparando PDF…' : 'Descargar selección'}
            {selectedIds.size > 0 && (
              <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px]">
                {selectedIds.size}
              </span>
            )}
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-600">
            Ordenes disponibles
          </p>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
            {exams.length}
          </span>
        </div>
      </div>

      <LabViewerExamFilters
        filterCategories={filterCategories}
        activeFilter={activeFilter}
        allSelected={allSelected}
        hasSelectableExams={selectableExams.length > 0}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onFilterChange={onFilterChange}
        onSelectAll={onSelectAll}
        onSelectByDays={onSelectByDays}
        onApplyDateRange={handleDateRangeSelect}
      />

      <div className="space-y-2">
        {exams.map((exam, index) => {
          const isSelected = selectedIds.has(exam.id);
          return (
            <LabViewerExamCard
              key={`${exam.id}-${index}`}
              exam={exam}
              isSelected={isSelected}
              copiedExamId={copiedExamId}
              copyingExamId={copyingExamId}
              onToggleSelect={onToggleSelect}
              onViewPdf={onViewPdf}
              onCopySummary={handleCopySummary}
            />
          );
        })}
      </div>
    </div>
  );
};
