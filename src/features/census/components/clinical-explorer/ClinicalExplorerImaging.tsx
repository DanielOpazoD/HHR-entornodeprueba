import React, { lazy, Suspense, useState } from 'react';
import { FileText, Images } from 'lucide-react';
import { XRayIcon } from '@/components/ui/XRayIcon';
import { hasMMRADStructuredReport } from '@/components/modals/controllers/radiologyViewerContentController';
import { useDicomReviewCache } from '@/components/radiology/useDicomReviewCache';
import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import {
  describeMMRADRegisteredPatient,
  fetchMMRADPdfBlobUrl,
  type MMRADExam,
} from '@/services/radiology/mmradService';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { formatStudyStamp, isCtStudy, studyKey } from './clinicalExplorerImagingModel';
import {
  AreaCard,
  EmptyNote,
  LinkButton,
  ReadFailure,
  SkeletonLines,
  type ClinicalExplorerTab,
} from './clinicalExplorerUi';
import { useClinicalExplorerImaging } from './useClinicalExplorerImaging';

const DicomViewerDialog = lazy(() =>
  import('@/components/radiology/DicomViewerDialog').then(module => ({
    default: module.DicomViewerDialog,
  }))
);

interface ClinicalExplorerImagingProps {
  patient: ClinicalExplorerPatient;
  tab: ClinicalExplorerTab;
  onShowAll: (tab: ClinicalExplorerTab) => void;
}

const COMPACT_STUDIES = 4;
const SMALL_BUTTON =
  'inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:cursor-wait disabled:opacity-60';

const ReportText: React.FC<{ exam: MMRADExam }> = ({ exam }) => {
  const report = exam.report;
  if (!report) return null;
  const sections: Array<[string, string | null]> = [
    ['Técnica', report.technique],
    ['Hallazgos', report.findings],
    ['Impresión', report.impression],
  ];
  return (
    <dl className="mt-1.5 flex flex-col gap-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2 text-[12px] leading-relaxed text-slate-700">
      {sections.map(([label, text]) =>
        text ? (
          <div key={label}>
            <dt className="text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
            <dd className={label === 'Impresión' ? 'font-medium text-slate-800' : undefined}>{text}</dd>
          </div>
        ) : null
      )}
    </dl>
  );
};

/** MMRAD studies of the hospitalization: plain list, viewer for images, report only for CT. */
export const ClinicalExplorerImaging: React.FC<ClinicalExplorerImagingProps> = ({
  patient,
  tab,
  onShowAll,
}) => {
  const expanded = tab === 'img';
  const rut = patient.data.rut.trim();
  const patientName = patient.data.patientName.trim();
  const imaging = useClinicalExplorerImaging({
    rut,
    patientName,
    admissionDate: patient.data.admissionDate,
    enabled: true,
  });
  const reviewCache = useDicomReviewCache(true, rut);
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const studies = expanded ? imaging.studies : imaging.studies.slice(0, COMPACT_STUDIES);
  const viewerExam = imaging.studies.find(exam => studyKey(exam) === viewerKey) ?? null;

  const openPdf = async (exam: MMRADExam): Promise<void> => {
    if (!exam.pdf_url) return;
    const popup = defaultBrowserWindowRuntime.open('', '_blank');
    if (!popup) return;
    setPdfMessage(null);
    setPdfBusy(studyKey(exam));
    try {
      const url = await fetchMMRADPdfBlobUrl(exam.pdf_url);
      popup.location.href = url;
      popup.focus();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      popup.close();
      setPdfMessage(error instanceof Error ? error.message : 'No se pudo abrir el informe.');
    } finally {
      setPdfBusy(null);
    }
  };

  const body = (): React.ReactNode => {
    if (imaging.phase === 'listing') return <SkeletonLines label="Consultando MMRAD" />;
    if (imaging.phase === 'error') return <ReadFailure message={imaging.message} onRetry={imaging.retry} />;
    if (imaging.phase === 'empty') {
      return (
        <>
          <EmptyNote>Sin estudios de imágenes en esta hospitalización.</EmptyNote>
          {imaging.partial && (
            <p className="text-[11px] text-slate-500">
              La búsqueda por dígito verificador no terminó; puede faltar algún estudio.
            </p>
          )}
        </>
      );
    }
    return (
      <>
        <ul className="flex flex-col divide-y divide-slate-100">
          {studies.map(exam => {
            const key = studyKey(exam);
            const ct = isCtStudy(exam);
            const structured = hasMMRADStructuredReport(exam);
            return (
              <li key={key} className="flex flex-col py-1.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-slate-700">{exam.nombre_examen}</p>
                    <p className="text-[10.5px] tabular-nums text-slate-500">
                      {formatStudyStamp(exam.fecha_examen)}
                      {exam.registered_patient_id && (
                        <span className="ml-2 text-slate-500">
                          · {describeMMRADRegisteredPatient(exam.registered_patient_id, exam.registered_patient_name)}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {exam.dicom_url && (
                      <button type="button" className={SMALL_BUTTON} onClick={() => setViewerKey(key)}>
                        <Images size={13} aria-hidden="true" className="text-violet-700" />
                        Imágenes
                      </button>
                    )}
                    {ct && structured && (
                      <button
                        type="button"
                        className={SMALL_BUTTON}
                        aria-expanded={openReport === key}
                        onClick={() => setOpenReport(current => (current === key ? null : key))}
                      >
                        <FileText size={13} aria-hidden="true" className="text-slate-500" />
                        Informe
                      </button>
                    )}
                    {ct && !structured && exam.pdf_url && (
                      <button
                        type="button"
                        className={SMALL_BUTTON}
                        disabled={pdfBusy === key}
                        onClick={() => void openPdf(exam)}
                      >
                        <FileText size={13} aria-hidden="true" className="text-slate-500" />
                        Informe (PDF)
                      </button>
                    )}
                  </div>
                </div>
                {openReport === key && <ReportText exam={exam} />}
              </li>
            );
          })}
        </ul>
        {!expanded && imaging.studies.length > studies.length && (
          <LinkButton onClick={() => onShowAll('img')}>
            Ver los {imaging.studies.length} estudios ›
          </LinkButton>
        )}
        {(imaging.partial || imaging.refreshMessage || pdfMessage) && (
          <p className="text-[11px] text-slate-500">
            {imaging.partial && 'La búsqueda por dígito verificador no terminó; puede faltar algún estudio. '}
            {imaging.refreshMessage && `No se pudo actualizar la lista: ${imaging.refreshMessage}. `}
            {pdfMessage}
          </p>
        )}
      </>
    );
  };

  return (
    <AreaCard
      icon={<XRayIcon size={14} />}
      iconClassName="bg-violet-50 text-violet-700"
      title="Imágenes"
      subtitle={
        imaging.phase === 'ready' || imaging.phase === 'empty'
          ? `${imaging.studies.length} ${imaging.studies.length === 1 ? 'estudio' : 'estudios'}`
          : undefined
      }
      source="MMRAD"
      actions={
        !expanded && imaging.phase === 'ready' ? (
          <LinkButton onClick={() => onShowAll('img')}>Ver todo ›</LinkButton>
        ) : undefined
      }
    >
      {body()}
      {viewerExam?.dicom_url && (
        <Suspense fallback={<p role="status" className="text-[11px] text-slate-500">Cargando visor…</p>}>
          <DicomViewerDialog
            key={`${rut}:${viewerExam.dicom_url}`}
            reviewCache={reviewCache}
            link={viewerExam.dicom_url}
            patientId={rut}
            registeredPatientId={viewerExam.registered_patient_id}
            registeredPatientName={viewerExam.registered_patient_name}
            patientName={patientName}
            studyDate={viewerExam.fecha_examen}
            reportLink={viewerExam.pdf_url}
            title={viewerExam.nombre_examen}
            onClose={() => setViewerKey(null)}
          />
        </Suspense>
      )}
    </AreaCard>
  );
};
