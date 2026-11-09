import React, { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { FileText, Images } from 'lucide-react';
import { XRayIcon } from '@/components/ui/XRayIcon';
import { hasMMRADStructuredReport } from '@/components/modals/controllers/radiologyViewerContentController';
import { useDicomReviewCache } from '@/components/radiology/useDicomReviewCache';
import {
  clinicalExplorerPatientIdentity,
  type ClinicalExplorerPatient,
} from '@/features/census/controllers/clinicalExplorerController';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { describeMMRADRegisteredPatient, type MMRADExam } from '@/services/radiology/mmradService';
import { getSessionEpoch, onSessionChange } from '@/services/storage/sessionStorageTransition';
import { deliverMmradPdf } from '@/services/radiology/mmradPdfDelivery';
import {
  asMmradDateBound,
  formatStudyStamp,
  isCtStudy,
  studyKey,
} from './clinicalExplorerImagingModel';
import {
  AreaCard,
  EXPLORER_ACTION_BUTTON,
  EmptyNote,
  LinkButton,
  ReadFailure,
  SkeletonLines,
  type ClinicalExplorerTab,
} from './clinicalExplorerUi';
import { useClinicalExplorerImaging } from './useClinicalExplorerImaging';
import { ClinicalExplorerReportActions } from './ClinicalExplorerReportActions';
import { ClinicalExplorerIdentityNotice } from './ClinicalExplorerIdentityNotice';

const DicomViewerDialog = lazy(() =>
  import('@/components/radiology/DicomViewerDialog').then(module => ({
    default: module.DicomViewerDialog,
  }))
);

interface ClinicalExplorerImagingProps {
  patient: ClinicalExplorerPatient;
  tab: ClinicalExplorerTab;
  onShowAll: (tab: ClinicalExplorerTab) => void;
  /**
   * Session and patient scope that asked for studies before admission. The explorer owns it:
   * «Ver los N estudios» remounts this card, and the choice must survive that.
   */
  historyFor: string | null;
  onHistoryForChange: (scope: string | null) => void;
}

const COMPACT_STUDIES = 4;
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
            <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
            <dd className={label === 'Impresión' ? 'font-medium text-slate-800' : undefined}>
              {text}
            </dd>
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
  historyFor,
  onHistoryForChange,
}) => {
  const expanded = tab === 'img';
  const sessionEpoch = useSessionEpoch();
  const patientIdentity = clinicalExplorerPatientIdentity(patient);
  const historyScope = `${sessionEpoch}:${patientIdentity}`;
  const includeHistory = historyFor === historyScope;
  const today = formatDateDDMMYYYY(getClinicalCalendarDateISO());
  const hasAdmissionBound = Boolean(asMmradDateBound(patient.data.admissionDate));
  const fullHistory = includeHistory || !hasAdmissionBound;
  const rut = patient.data.rut.trim();
  const patientName = patient.data.patientName.trim();
  const imaging = useClinicalExplorerImaging({
    rut,
    patientName,
    admissionDate: includeHistory ? '' : patient.data.admissionDate,
    enabled: true,
  });
  const reviewCache = useDicomReviewCache(true, rut);
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const pdfOperation = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    setPdfBusy(null);
    setPdfMessage(null);
    const cancel = (): void => {
      const pending = pdfOperation.current;
      pdfOperation.current = null;
      pending?.abort();
    };
    const unsubscribe = onSessionChange(() => {
      cancel();
      setPdfBusy(null);
      setPdfMessage(null);
    });
    return () => {
      unsubscribe();
      cancel();
    };
  }, [patientIdentity, sessionEpoch]);

  const studies = expanded ? imaging.studies : imaging.studies.slice(0, COMPACT_STUDIES);
  const viewerExam = imaging.studies.find(exam => studyKey(exam) === viewerKey) ?? null;

  const openPdf = async (exam: MMRADExam): Promise<void> => {
    if (!exam.pdf_url || pdfOperation.current || getSessionEpoch() !== sessionEpoch) return;
    const operation = new AbortController();
    pdfOperation.current = operation;
    const isCurrent = (): boolean =>
      pdfOperation.current === operation &&
      !operation.signal.aborted &&
      getSessionEpoch() === sessionEpoch;
    setPdfMessage(null);
    setPdfBusy(studyKey(exam));
    try {
      await deliverMmradPdf(exam.pdf_url, operation, { print: false });
    } catch (error) {
      if (isCurrent()) {
        setPdfMessage(error instanceof Error ? error.message : 'No se pudo abrir el informe.');
      }
    } finally {
      if (pdfOperation.current === operation) {
        pdfOperation.current = null;
        setPdfBusy(null);
      }
    }
  };

  const body = (): React.ReactNode => {
    if (imaging.phase === 'listing') return <SkeletonLines label="Consultando MMRAD" />;
    if (imaging.phase === 'error')
      return (
        <ReadFailure
          summary="No se pudo consultar imágenes."
          message={imaging.message}
          onRetry={imaging.retry}
        />
      );
    if (imaging.phase === 'empty') {
      return (
        <>
          <EmptyNote>
            {fullHistory
              ? 'Sin estudios de imágenes en MMRAD para este paciente.'
              : 'Sin estudios de imágenes desde el ingreso. Puede haber exámenes anteriores.'}
          </EmptyNote>
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
                <div className="grid min-w-0 grid-cols-1 items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_136px_208px]">
                  <p
                    title={exam.nombre_examen}
                    className="min-w-0 line-clamp-2 text-[12px] font-semibold text-slate-700"
                  >
                    {exam.nombre_examen}
                  </p>
                  <p
                    data-testid="clinical-imaging-date"
                    className="relative flex items-center gap-1 text-[10.5px] tabular-nums text-slate-500"
                  >
                    {formatStudyStamp(exam.fecha_examen)}
                    {exam.registered_patient_id && (
                      <ClinicalExplorerIdentityNotice
                        message={describeMMRADRegisteredPatient(
                          exam.registered_patient_id,
                          exam.registered_patient_name
                        )}
                      />
                    )}
                  </p>
                  <div
                    data-testid="clinical-imaging-actions"
                    className="flex items-center gap-1.5 whitespace-nowrap sm:justify-end"
                  >
                    {exam.dicom_url && (
                      <button
                        type="button"
                        className={EXPLORER_ACTION_BUTTON}
                        onClick={() => setViewerKey(key)}
                      >
                        <Images size={13} aria-hidden="true" className="text-slate-500" />
                        Imágenes
                      </button>
                    )}
                    {ct && structured && (
                      <button
                        type="button"
                        className={EXPLORER_ACTION_BUTTON}
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
                        className={EXPLORER_ACTION_BUTTON}
                        disabled={pdfBusy !== null}
                        onClick={() => void openPdf(exam)}
                      >
                        <FileText size={13} aria-hidden="true" className="text-slate-500" />
                        Informe (PDF)
                      </button>
                    )}
                  </div>
                </div>
                {openReport === key && (
                  <>
                    <ReportText exam={exam} />
                    <ClinicalExplorerReportActions
                      key={`${patientIdentity}:${sessionEpoch}:${key}`}
                      exam={exam}
                    />
                  </>
                )}
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
            {imaging.partial &&
              'La búsqueda por dígito verificador no terminó; puede faltar algún estudio. '}
            {imaging.refreshMessage &&
              `No se pudo actualizar la lista: ${imaging.refreshMessage}. `}
            {pdfMessage}
          </p>
        )}
      </>
    );
  };

  return (
    <AreaCard
      icon={<XRayIcon size={14} />}
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
      <div className="mb-2 space-y-1 border-b border-slate-100 pb-2 text-[11px] text-slate-600">
        <p>
          {fullHistory
            ? `Período: todo el historial disponible en MMRAD, hasta hoy (${today}).`
            : `Período: desde el ingreso (${formatDateDDMMYYYY(patient.data.admissionDate)}) hasta hoy (${today}).`}
        </p>
        {hasAdmissionBound && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeHistory}
              onChange={event => onHistoryForChange(event.target.checked ? historyScope : null)}
            />
            Incluir exámenes anteriores al ingreso
          </label>
        )}
      </div>
      {body()}
      {viewerExam?.dicom_url && (
        <Suspense
          fallback={
            <p role="status" className="text-[11px] text-slate-500">
              Cargando visor…
            </p>
          }
        >
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
