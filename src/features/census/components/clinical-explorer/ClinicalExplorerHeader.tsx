import React, { lazy, Suspense, useState } from 'react';
import { FlaskConical, FolderOpen } from 'lucide-react';
import { XRayIcon } from '@/components/ui/XRayIcon';
import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import { calculateHospitalizedDays } from '@/features/census/controllers/patientBedConfigViewController';
import { formatAge } from '@/utils/ageDisplayUtils';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { StatusDot } from './clinicalExplorerUi';

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

type QuickAction = 'imaging' | 'documents';

interface ClinicalExplorerHeaderProps {
  patient: ClinicalExplorerPatient;
  /** The laboratory request belongs to the explorer: it may gather several patients. */
  onRequestExams: () => void;
  censusDate: string;
}

const QUICK_BUTTON =
  'inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700';

/** Who is being reviewed, where they are, and the quick requests, in two short lines. */
export const ClinicalExplorerHeader: React.FC<ClinicalExplorerHeaderProps> = ({
  patient,
  onRequestExams,
  censusDate,
}) => {
  const { data, bedId, episodeId } = patient;
  const identity = `${bedId}:${episodeId}`;
  // A request dialog belongs to one patient; moving on drops it instead of carrying it over.
  const [open, setOpen] = useState<{ identity: string; kind: QuickAction } | null>(null);
  const action = open?.identity === identity ? open.kind : null;
  const setAction = (kind: QuickAction | null): void => setOpen(kind ? { identity, kind } : null);

  const patientName = data.patientName.trim();
  const days = calculateHospitalizedDays({
    admissionDate: data.admissionDate,
    currentDate: censusDate,
  });
  const diagnosis = data.pathology.trim();

  return (
    <header
      data-testid="clinical-explorer-patient"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-slate-200 bg-white px-3 py-2"
    >
      <span className="inline-flex h-8 min-w-9 items-center justify-center rounded-lg bg-slate-100 px-2 font-display text-[15px] font-bold text-slate-800">
        {bedId}
      </span>
      <div className="flex min-w-0 flex-1 basis-[18rem] flex-col gap-0.5">
        <h2 className="flex min-w-0 items-baseline gap-2 text-[15px] font-semibold leading-snug text-slate-800">
          <span className="min-w-0 truncate" title={patientName}>
            {patientName}
          </span>
          <span className="shrink-0 text-[12px] font-normal text-slate-500">
            ({formatAge(data.age)})
          </span>
          {data.status && (
            <span className="inline-flex shrink-0 items-center gap-1 self-center text-[12px] font-medium text-slate-600">
              <StatusDot status={data.status} className="size-2" />
              {data.status}
            </span>
          )}
        </h2>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] leading-relaxed text-slate-600 sm:flex-nowrap">
          <span className="shrink-0 tabular-nums">{data.rut.trim()}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0 tabular-nums">
            Ingreso {formatDateDDMMYYYY(data.admissionDate)}
            {days !== null && ` · ${days} d`}
          </span>
          {data.specialty && (
            <>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{data.specialty}</span>
            </>
          )}
          {diagnosis && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate font-medium text-slate-700" title={diagnosis}>
                {diagnosis}
              </span>
            </>
          )}
        </p>
      </div>
      <div
        role="group"
        aria-label="Solicitudes para este paciente"
        className="ml-auto flex flex-wrap items-center gap-1"
      >
        <button
          type="button"
          className={QUICK_BUTTON}
          onClick={onRequestExams}
          title="Solicitar exámenes de sangre"
        >
          <FlaskConical size={13} aria-hidden="true" className="text-slate-500" />
          Exámenes
        </button>
        <button
          type="button"
          className={QUICK_BUTTON}
          onClick={() => setAction('imaging')}
          title="Orden de radiología"
        >
          <XRayIcon size={13} className="text-slate-500" />
          Radiología
        </button>
        <button
          type="button"
          className={QUICK_BUTTON}
          onClick={() => setAction('documents')}
          title="Documentos clínicos"
        >
          <FolderOpen size={13} aria-hidden="true" className="text-slate-500" />
          Documentos
        </button>
      </div>

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
