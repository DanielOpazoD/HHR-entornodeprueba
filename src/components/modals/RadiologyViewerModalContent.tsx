import React from 'react';
import clsx from 'clsx';
import {
  Calendar,
  Check,
  ClipboardCopy,
  FileText,
  Loader2,
  Monitor,
  Printer,
  Radio,
  Search,
} from 'lucide-react';
import type { MMRADExam, MMRADSearchResult } from '@/services/radiology/mmradService';
import { buildMMRADExamKey } from '@/components/modals/controllers/radiologyViewerModalController';
import {
  buildRadiologyResultsEmptyMessage,
  countMMRADExamsForModality,
  hasMMRADStructuredReport,
  shouldHideMMRADStatusBadge,
} from '@/components/modals/controllers/radiologyViewerContentController';

interface RadiologyPatient {
  bedId: string;
  label: string;
  patientName: string;
  rut: string;
  diagnosis?: string;
}

interface RadiologyViewerControlsProps {
  uniquePatients: RadiologyPatient[];
  selectedRut: string;
  isLoading: boolean;
  dateFrom: string;
  dateTo: string;
  onPatientChange: (rut: string) => void;
  onSearch: () => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onSetDatePreset: (preset: 'last-month' | 'last-year' | 'last-5-years') => void;
  onClearDates: () => void;
}

export const RadiologyViewerControls = ({
  uniquePatients,
  selectedRut,
  isLoading,
  dateFrom,
  dateTo,
  onPatientChange,
  onSearch,
  onDateFromChange,
  onDateToChange,
  onSetDatePreset,
  onClearDates,
}: RadiologyViewerControlsProps) => (
  <div className="mb-4 space-y-2">
    <div className="flex items-center gap-2">
      <div className="flex flex-1 items-center gap-2">
        <label className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Paciente
        </label>
        <select
          value={selectedRut}
          onChange={e => onPatientChange(e.target.value)}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-500/10"
        >
          {uniquePatients.map(patient => (
            <option key={patient.bedId} value={patient.rut}>
              {patient.label} ({patient.rut})
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={onSearch}
        disabled={!selectedRut || isLoading}
        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-violet-500 to-violet-600 px-4 py-2 text-[13px] font-semibold text-white shadow-md shadow-violet-600/25 transition-all hover:from-violet-600 hover:to-violet-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      >
        {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        Buscar
      </button>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <Calendar size={13} className="shrink-0 text-slate-400" />
      <input
        type="date"
        value={dateFrom}
        onChange={e => onDateFromChange(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-600 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/10"
        title="Fecha desde"
      />
      <span className="text-[10px] text-slate-400">—</span>
      <input
        type="date"
        value={dateTo}
        onChange={e => onDateToChange(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-600 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/10"
        title="Fecha hasta"
      />
      <div className="h-4 w-px bg-slate-200/60" />
      <button
        type="button"
        onClick={() => onSetDatePreset('last-month')}
        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-100"
      >
        Último mes
      </button>
      <button
        type="button"
        onClick={() => onSetDatePreset('last-year')}
        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-100"
      >
        Último año
      </button>
      <button
        type="button"
        onClick={() => onSetDatePreset('last-5-years')}
        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-100"
      >
        Últimos 5 años
      </button>
      {(dateFrom || dateTo) && (
        <button
          type="button"
          onClick={onClearDates}
          className="text-[10px] text-slate-400 transition-colors hover:text-slate-600"
        >
          Limpiar
        </button>
      )}
    </div>
  </div>
);

export const RadiologyViewerProgress = ({
  progress,
}: {
  progress: { pct: number; text: string } | null;
}) =>
  progress ? (
    <div className="mb-4">
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-slate-200/80">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-[width] duration-500 ease-out"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-center text-[11px] text-slate-400">{progress.text}</p>
    </div>
  ) : null;

const RadiologyViewerResultsHeader = ({
  result,
  modalities,
  activeModTab,
  filteredCount,
  onTabChange,
}: {
  result: MMRADSearchResult;
  modalities: string[];
  activeModTab: string | null;
  filteredCount: number;
  onTabChange: (modality: string | null) => void;
}) => (
  <>
    {modalities.length > 1 && (
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onTabChange(null)}
          className={clsx(
            'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all',
            activeModTab === null
              ? 'bg-violet-100 text-violet-800 ring-1 ring-violet-200/50 shadow-sm'
              : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
          )}
        >
          Todos ({result.examenes.length})
        </button>
        {modalities.map(modality => {
          const count = countMMRADExamsForModality(result, modality);
          return (
            <button
              key={modality}
              type="button"
              onClick={() => onTabChange(modality)}
              className={clsx(
                'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all',
                activeModTab === modality
                  ? 'bg-violet-100 text-violet-800 ring-1 ring-violet-200/50 shadow-sm'
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              )}
            >
              {modality} ({count})
            </button>
          );
        })}
      </div>
    )}

    <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
      {filteredCount} exámenes
      {activeModTab ? ` · ${activeModTab}` : ''}
    </p>
  </>
);

const RadiologyExamCard = ({
  exam,
  onOpenPdf,
  onOpenPortalReceipt,
  onOpenDicom,
  onCopyReport,
  isCopyConfirmed,
}: {
  exam: MMRADExam;
  onOpenPdf: (exam: MMRADExam) => void;
  onOpenPortalReceipt: (exam: MMRADExam) => void;
  onOpenDicom?: (exam: MMRADExam) => void;
  onCopyReport: (exam: MMRADExam) => void;
  isCopyConfirmed: boolean;
}) => {
  const hideStatusBadge = shouldHideMMRADStatusBadge(exam);
  const hasStructuredReport = hasMMRADStructuredReport(exam);

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm ring-1 ring-black/[0.02] transition-all hover:shadow-md">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h4 className="text-[13px] font-semibold text-slate-700">
            {exam.nombre_examen || 'Examen sin nombre'}
          </h4>
          <div className="mt-0.5 flex items-center gap-3 text-[10px] text-slate-400">
            {exam.fecha_examen && <span>Fecha: {exam.fecha_examen}</span>}
            {exam.mod && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">
                {exam.mod}
              </span>
            )}
          </div>
        </div>
        {!hideStatusBadge && exam.estado && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              exam.estado.toLowerCase() === 'validado'
                ? 'border border-emerald-200/80 bg-emerald-50 text-emerald-700'
                : 'border border-amber-200/80 bg-amber-50 text-amber-700'
            }`}
          >
            {exam.estado}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {exam.pdf_url && (
          <button
            type="button"
            onClick={() => onOpenPdf(exam)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
          >
            <FileText size={12} />
            Ver PDF
          </button>
        )}
        {exam.portal_web_receipt_url && (
          <button
            type="button"
            onClick={() => onOpenPortalReceipt(exam)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
          >
            <Printer size={12} />
            Comprobante portal
          </button>
        )}
        {exam.dicom_url && onOpenDicom && (
          <button
            type="button"
            onClick={() => onOpenDicom(exam)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100"
          >
            <Monitor size={12} />
            Ver DICOM
          </button>
        )}
        {exam.dicom_url && (
          <a
            href={exam.dicom_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-100"
          >
            <Monitor size={12} />
            Visualizador DICOM HTML5
          </a>
        )}
        {hasStructuredReport && (
          <>
            <button
              type="button"
              onClick={() => onCopyReport(exam)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-all',
                isCopyConfirmed
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm'
                  : 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
              )}
            >
              {isCopyConfirmed ? <Check size={12} /> : <ClipboardCopy size={12} />}
              {isCopyConfirmed ? 'Copiado' : 'Copiar informe'}
            </button>
          </>
        )}
        {!exam.pdf_url && !exam.portal_web_receipt_url && !exam.dicom_url && (
          <span className="text-[11px] italic text-slate-400">Sin acciones disponibles</span>
        )}
      </div>
    </div>
  );
};

export const RadiologyViewerResults = ({
  result,
  isLoading,
  modalities,
  activeModTab,
  filteredExams,
  onTabChange,
  onOpenPdf,
  onOpenPortalReceipt,
  onOpenDicom,
  onCopyReport,
  copiedReportExamKey,
}: {
  result: MMRADSearchResult | null;
  isLoading: boolean;
  modalities: string[];
  activeModTab: string | null;
  filteredExams: MMRADExam[];
  onTabChange: (modality: string | null) => void;
  onOpenPdf: (exam: MMRADExam) => void;
  onOpenPortalReceipt: (exam: MMRADExam) => void;
  onOpenDicom?: (exam: MMRADExam) => void;
  onCopyReport: (exam: MMRADExam) => void;
  copiedReportExamKey: string | null;
}) => {
  if (!result || isLoading) return null;

  return (
    <div className="space-y-3">
      <RadiologyViewerResultsHeader
        result={result}
        modalities={modalities}
        activeModTab={activeModTab}
        filteredCount={filteredExams.length}
        onTabChange={onTabChange}
      />

      {filteredExams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Radio size={28} className="mb-2 text-slate-200" />
          <p className="text-[13px] text-slate-400">
            {buildRadiologyResultsEmptyMessage(activeModTab)}
          </p>
        </div>
      ) : (
        filteredExams.map((exam, index) => (
          <RadiologyExamCard
            key={index}
            exam={exam}
            onOpenPdf={onOpenPdf}
            onOpenPortalReceipt={onOpenPortalReceipt}
            onOpenDicom={onOpenDicom}
            onCopyReport={onCopyReport}
            isCopyConfirmed={copiedReportExamKey === buildMMRADExamKey(exam)}
          />
        ))
      )}
    </div>
  );
};

export const RadiologyViewerEmptyState = () => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
      <Radio size={26} />
    </span>
    <p className="text-[13px] font-medium text-slate-400">Selecciona un paciente y busca</p>
    <p className="mt-0.5 text-[11px] text-slate-300">
      Los exámenes del RIS MMRAD se mostrarán aquí
    </p>
  </div>
);
