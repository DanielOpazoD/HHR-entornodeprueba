import React, { lazy, Suspense, useState } from 'react';
import { ChevronLeft, ChevronRight, FlaskConical, FolderOpen } from 'lucide-react';
import { XRayIcon } from '@/components/ui/XRayIcon';
import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import { calculateHospitalizedDays } from '@/features/census/controllers/patientBedConfigViewController';
import { formatAge } from '@/utils/ageDisplayUtils';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { StatusDot } from './clinicalExplorerUi';

const LazyExamRequestModal = lazy(() =>
  import('@/components/modals/ExamRequestModal').then(module => ({
    default: module.ExamRequestModal,
  }))
);
const LazyImagingRequestDialog = lazy(() =>
  import('@/components/modals/ImagingRequestDialog').then(module => ({
    default: module.ImagingRequestDialog,
  }))
);
const LazyClinicalDocumentsModal = lazy(() =>
  import('@/features/clinical-documents').then(module => ({
    default: module.ClinicalDocumentsModal,
  }))
);

type QuickAction = 'exam' | 'imaging' | 'documents';

interface ClinicalExplorerHeaderProps {
  patient: ClinicalExplorerPatient;
  censusDate: string;
  position: { index: number; total: number };
  previousBedId: string | null;
  nextBedId: string | null;
  onSelect: (bedId: string) => void;
}

const NAV_BUTTON =
  'inline-flex h-8 items-center gap-1 px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:text-slate-300';
const QUICK_BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700';

/** Who is being reviewed (patient and episode), where they are, and the quick requests. */
export const ClinicalExplorerHeader: React.FC<ClinicalExplorerHeaderProps> = ({
  patient,
  censusDate,
  position,
  previousBedId,
  nextBedId,
  onSelect,
}) => {
  const { data, bedId, episodeId } = patient;
  const identity = `${bedId}:${episodeId}`;
  // A request dialog belongs to one patient; moving on drops it instead of carrying it over.
  const [open, setOpen] = useState<{ identity: string; kind: QuickAction } | null>(null);
  const action = open?.identity === identity ? open.kind : null;
  const setAction = (kind: QuickAction | null): void =>
    setOpen(kind ? { identity, kind } : null);

  const patientName = data.patientName.trim();
  const days = calculateHospitalizedDays({
    admissionDate: data.admissionDate,
    currentDate: censusDate,
  });
  const diagnosis = data.pathology.trim();

  return (
    <header
      data-testid="clinical-explorer-patient"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-slate-200 bg-white px-3.5 py-2.5"
    >
      <div className="flex min-w-14 flex-col items-center leading-none">
        <span className="font-display text-[22px] font-bold text-slate-800">{bedId}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold uppercase text-slate-800">
          {patientName}
          <span className="text-[11px] font-normal normal-case text-slate-400">
            ({formatAge(data.age)})
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium normal-case text-slate-600">
            <StatusDot status={data.status} />
            {data.status || 'Sin estado'}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-600">
          <span className="tabular-nums">{data.rut.trim()}</span>
          <span
            className="rounded border border-slate-200 bg-slate-50 px-1.5 font-mono text-[10.5px] text-slate-700"
            title="Episodio de hospitalización en Eloísa"
          >
            Ep. {episodeId}
          </span>
          <span className="tabular-nums">
            Ingreso {formatDateDDMMYYYY(data.admissionDate)}
            {days !== null && ` · ${days} d`}
          </span>
          {data.specialty && (
            <span className="rounded bg-sky-50 px-1 py-px text-[9px] font-medium text-sky-600 ring-1 ring-sky-100">
              {data.specialty}
            </span>
          )}
        </div>
        {diagnosis && (
          <p className="truncate text-[12.5px] text-slate-700" title={diagnosis}>
            {diagnosis}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] tabular-nums text-slate-500">
          {position.index + 1} de {position.total}
        </span>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
          <button
            type="button"
            className={NAV_BUTTON}
            disabled={!previousBedId}
            onClick={() => previousBedId && onSelect(previousBedId)}
            aria-label="Paciente anterior"
          >
            <ChevronLeft size={14} aria-hidden="true" />
            Anterior
          </button>
          <button
            type="button"
            className={`${NAV_BUTTON} border-l border-slate-200`}
            disabled={!nextBedId}
            onClick={() => nextBedId && onSelect(nextBedId)}
            aria-label="Paciente siguiente"
          >
            Siguiente
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        role="group"
        aria-label="Solicitudes para este paciente"
        className="flex basis-full flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2"
      >
        <button type="button" className={QUICK_BUTTON} onClick={() => setAction('exam')}>
          <FlaskConical size={14} aria-hidden="true" className="text-emerald-700" />
          Solicitar exámenes
        </button>
        <button type="button" className={QUICK_BUTTON} onClick={() => setAction('imaging')}>
          <XRayIcon size={14} className="text-violet-700" />
          Orden de radiología
        </button>
        <button type="button" className={QUICK_BUTTON} onClick={() => setAction('documents')}>
          <FolderOpen size={14} aria-hidden="true" className="text-slate-500" />
          Documentos clínicos
        </button>
      </div>

      {action === 'exam' && (
        <Suspense fallback={null}>
          <LazyExamRequestModal
            isOpen
            onClose={() => setAction(null)}
            patient={data}
            recordDate={censusDate}
          />
        </Suspense>
      )}
      {action === 'imaging' && (
        <Suspense fallback={null}>
          <LazyImagingRequestDialog isOpen onClose={() => setAction(null)} patient={data} />
        </Suspense>
      )}
      {action === 'documents' && (
        <Suspense fallback={null}>
          <LazyClinicalDocumentsModal
            isOpen
            onClose={() => setAction(null)}
            patient={data}
            currentDateString={censusDate}
            bedId={bedId}
          />
        </Suspense>
      )}
    </header>
  );
};
