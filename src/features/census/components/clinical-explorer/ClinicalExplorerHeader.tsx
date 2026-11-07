import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Download, FlaskConical, FolderOpen, MoreHorizontal } from 'lucide-react';
import { XRayIcon } from '@/components/ui/XRayIcon';
import { IsolationBadge } from '../patient-row/IsolationBadge';
import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import { calculateHospitalizedDays } from '@/features/census/controllers/patientBedConfigViewController';
import { formatAge } from '@/utils/ageDisplayUtils';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { ClinicalExplorerDownloadDialog } from './ClinicalExplorerDownloadDialog';
import { ClinicalExplorerPrintActions } from './ClinicalExplorerPrintActions';
import { StatusDot, EXPLORER_ACTION_BUTTON, EXPLORER_ICON_BUTTON } from './clinicalExplorerUi';

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

type QuickAction = 'imaging' | 'documents' | 'download';

interface ClinicalExplorerHeaderProps {
  patient: ClinicalExplorerPatient;
  /** The laboratory request belongs to the explorer: it may gather several patients. */
  onRequestExams: () => void;
  censusDate: string;
  /** Day chosen in the indications area; null means today. Printing uses the same day. */
  indicationDate: string | null;
}

const DOWNLOAD_LABEL = 'Descargar ficha, exámenes e informes';

/** Who is being reviewed, where they are, and the quick requests, in two short lines. */
export const ClinicalExplorerHeader: React.FC<ClinicalExplorerHeaderProps> = ({
  patient,
  onRequestExams,
  censusDate,
  indicationDate,
}) => {
  const { data, bedId, episodeId } = patient;
  const moreRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        moreRef.current &&
        !moreRef.current.contains(event.target)
      )
        moreRef.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  // Requests belong to the patient and episode in this bed: a corrected RUN or admission closes them.
  const identity = `${bedId}:${episodeId}:${data.rut.trim()}:${data.admissionDate}`;
  // A request dialog belongs to one patient; moving on drops it instead of carrying it over.
  const [open, setOpen] = useState<{ identity: string; kind: QuickAction } | null>(null);
  const action = open?.identity === identity ? open.kind : null;
  const setAction = (kind: QuickAction | null): void => {
    if (moreRef.current) moreRef.current.open = false;
    setOpen(kind ? { identity, kind } : null);
  };
  // A download stopped by leaving the patient does not reopen when they come back.
  if (open?.kind === 'download' && open.identity !== identity) setOpen(null);

  const patientName = data.patientName.trim();
  const days = calculateHospitalizedDays({
    admissionDate: data.admissionDate,
    currentDate: censusDate,
  });
  const diagnosis = data.pathology.trim();

  return (
    <header
      data-testid="clinical-explorer-patient"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/20 px-3 py-2"
    >
      <span className="flex shrink-0 flex-col items-center gap-1">
        <span className="inline-flex h-8 min-w-9 items-center justify-center rounded-lg bg-slate-100 px-2 font-display text-[15px] font-bold text-slate-800">
          {bedId}
        </span>
        {data.isIsolated && (
          <IsolationBadge
            isolationType={data.isolationType}
            microorganism={data.isolationMicroorganism}
          />
        )}
      </span>
      <div className="flex min-w-0 flex-1 basis-[16rem] flex-col gap-0.5">
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
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] leading-relaxed text-slate-600">
          <span className="shrink-0 tabular-nums">Censo {formatDateDDMMYYYY(censusDate)}</span>
          <span aria-hidden="true">·</span>
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
          className={EXPLORER_ACTION_BUTTON}
          onClick={onRequestExams}
          title="Solicitar exámenes de sangre"
        >
          <FlaskConical size={13} aria-hidden="true" className="text-slate-500" />
          Exámenes
        </button>
        <button
          type="button"
          className={EXPLORER_ACTION_BUTTON}
          onClick={() => setAction('imaging')}
          title="Orden de radiología"
        >
          <XRayIcon size={13} className="text-slate-500" />
          Radiología
        </button>
        <ClinicalExplorerPrintActions
          key={`print:${identity}`}
          compact
          patient={patient}
          indicationDate={indicationDate}
        />
        <details
          key={`more:${identity}`}
          ref={moreRef}
          className="relative"
          onKeyDown={event => {
            if (event.key === 'Escape' && moreRef.current?.open) {
              event.preventDefault();
              event.stopPropagation();
              moreRef.current.open = false;
              moreRef.current.querySelector('summary')?.focus();
            }
          }}
        >
          <summary
            role="button"
            aria-label="Más acciones del paciente"
            className={`${EXPLORER_ICON_BUTTON} list-none cursor-pointer [&::-webkit-details-marker]:hidden`}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </summary>
          <div className="absolute right-0 top-full z-50 mt-1 flex min-w-48 flex-col items-stretch gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            <button
              type="button"
              className={`${EXPLORER_ACTION_BUTTON} w-full`}
              onClick={() => setAction('documents')}
              title="Informes locales"
            >
              <FolderOpen size={13} aria-hidden="true" className="text-slate-500" />
              Informes locales
            </button>
            <button
              type="button"
              className={`${EXPLORER_ACTION_BUTTON} w-full`}
              onClick={() => setAction('download')}
              aria-label={DOWNLOAD_LABEL}
              title={DOWNLOAD_LABEL}
            >
              <Download size={13} aria-hidden="true" />
              Descargar ficha y exámenes
            </button>
          </div>
        </details>
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
      {action === 'download' && (
        <ClinicalExplorerDownloadDialog
          patient={patient}
          censusDate={censusDate}
          onClose={() => setAction(null)}
        />
      )}
    </header>
  );
};
