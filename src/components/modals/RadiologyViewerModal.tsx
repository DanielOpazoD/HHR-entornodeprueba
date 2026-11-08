import React, { useState, useCallback, useMemo, useRef } from 'react';
import { ClipboardPlus } from 'lucide-react';
import { searchMmradStudies } from '@/components/modals/controllers/mmradStudySearch';
import { useDicomReviewCache } from '@/components/radiology/useDicomReviewCache';
import { XRayIcon } from '@/components/ui/XRayIcon';
import { LAYER_Z_INDEX } from '@/shared/ui/layering';
import { normalizeDicomPatientId, type DicomCapture } from '@/services/radiology/dicomTypes';
import { BaseModal } from '@/components/shared/BaseModal';
import {
  fetchMMRADPortalReceiptHtml,
  type MMRADExam,
  type MMRADSearchResult,
} from '@/services/radiology/mmradService';
import {
  buildMMRADPortalReceiptPrintHtml,
  buildMMRADReportClipboardText,
} from '@/services/radiology/mmradReportSupport';
import {
  RadiologyViewerControls,
  RadiologyViewerEmptyState,
  RadiologyViewerProgress,
  RadiologyViewerResults,
} from '@/components/modals/RadiologyViewerModalContent';
import { RadiologyPortalReceiptPreview } from '@/components/modals/RadiologyPortalReceiptPreview';
import { deliverMmradPdf } from '@/services/radiology/mmradPdfDelivery';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import {
  buildFilteredMMRADExams,
  buildMMRADExamKey,
  buildUniqueRadiologyPatients,
  extractMMRADModalities,
  resolveInitialMMRADModalityTab,
  resolveMMRADDatePresetRange,
} from '@/components/modals/controllers/radiologyViewerModalController';
import { readRememberedMMRADExams } from '@/components/modals/controllers/radiologyExamListMemory';

const DicomViewerDialog = React.lazy(() =>
  import('@/components/radiology/DicomViewerDialog').then(module => ({
    default: module.DicomViewerDialog,
  }))
);

interface RadiologyViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  patients: RadiologyPatient[];
  initialPatientRut?: string;
  autoSearchInitialPatient?: boolean;
  onCapture?: (capture: DicomCapture) => void;
  onRequestImaging?: () => void;
}

interface RadiologyPatient {
  bedId: string;
  label: string;
  patientName: string;
  rut: string;
  diagnosis?: string;
}

export const RadiologyViewerModal: React.FC<RadiologyViewerModalProps> = ({
  isOpen,
  onClose,
  patients,
  initialPatientRut,
  autoSearchInitialPatient = false,
  onCapture,
  onRequestImaging,
}) => {
  const [selectedRut, setSelectedRut] = useState(initialPatientRut || patients[0]?.rut || '');
  const normalizedRut = normalizeDicomPatientId(selectedRut);
  const reviewCache = useDicomReviewCache(isOpen, selectedRut);
  // A foreground search has nothing to show yet; a background one refreshes a remembered list.
  const [searchMode, setSearchMode] = useState<'foreground' | 'background' | null>(null);
  const isLoading = searchMode !== null;
  const isForegroundLoading = searchMode === 'foreground';
  // Painted from the first frame when this session remembers the patient's list.
  const [result, setResult] = useState<MMRADSearchResult | null>(() =>
    isOpen
      ? (readRememberedMMRADExams({ rut: selectedRut, dateFrom: '', dateTo: '' }) ?? null)
      : null
  );
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ pct: number; text: string } | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activeModTab, setActiveModTab] = useState<string | null>(null);
  const [copiedReportExamKey, setCopiedReportExamKey] = useState<string | null>(null);
  const [portalReceiptPreview, setPortalReceiptPreview] = useState<{
    title: string;
    html: string;
  } | null>(null);
  const copiedReportResetTimeoutRef = useRef<number | null>(null);
  const [dicomExam, setDicomExam] = useState<MMRADExam | null>(null);
  const searchSequence = useRef(0);
  const context = JSON.stringify([isOpen, selectedRut, dateFrom, dateTo]);
  const pdfOperation = useRef<AbortController | null>(null);
  React.useEffect(() => () => pdfOperation.current?.abort(), [context]);
  const latestContext = useRef(context);
  latestContext.current = context;
  const openedForRutRef = useRef<string | null>(null);

  const uniquePatients = useMemo(() => buildUniqueRadiologyPatients(patients), [patients]);
  const selectedPatientName = uniquePatients.find(
    patient => normalizeDicomPatientId(patient.rut) === normalizedRut
  )?.patientName;

  const modalities = useMemo(
    () => (result ? extractMMRADModalities(result.examenes) : []),
    [result]
  );

  const filteredExams = useMemo(
    () => buildFilteredMMRADExams(result, activeModTab),
    [result, activeModTab]
  );

  const tabListRutRef = useRef<string | null>(null);
  React.useEffect(() => {
    // A refresh of the patient's list keeps the tab the user chose while it is still offered.
    const listRut = result ? normalizeDicomPatientId(result.rut) : null;
    const isRefresh = listRut !== null && listRut === tabListRutRef.current;
    tabListRutRef.current = listRut;
    setActiveModTab(current =>
      isRefresh && (current === null || modalities.includes(current))
        ? current
        : resolveInitialMMRADModalityTab(modalities)
    );
  }, [result, modalities]);

  /**
   * Simulated progress bar.
   */
  React.useEffect(() => {
    if (!isForegroundLoading) {
      if (progress) {
        setProgress({ pct: 100, text: '¡Completado!' });
        const timeout = setTimeout(() => setProgress(null), 600);
        return () => clearTimeout(timeout);
      }
      return;
    }

    const steps = [
      { pct: 10, text: 'Conectando con el servidor de imágenes…' },
      { pct: 30, text: 'Iniciando sesión en RIS MMRAD…' },
      { pct: 50, text: 'Buscando exámenes del paciente…' },
      { pct: 70, text: 'Extrayendo informes y enlaces…' },
      { pct: 85, text: 'Procesando resultados…' },
    ];

    let step = 0;
    setProgress({ pct: steps[0].pct, text: steps[0].text });
    step = 1;

    const interval = setInterval(() => {
      if (step < steps.length) {
        setProgress({ pct: steps[step].pct, text: steps[step].text });
        step++;
      } else {
        setProgress(prev =>
          prev && prev.pct < 95
            ? { pct: Math.min(prev.pct + 1, 95), text: 'Finalizando consulta…' }
            : prev
        );
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isForegroundLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const patientsRef = useRef(uniquePatients);
  patientsRef.current = uniquePatients;
  const patientNameOf = (rut: string) =>
    patientsRef.current.find(
      patient => normalizeDicomPatientId(patient.rut) === normalizeDicomPatientId(rut)
    )?.patientName;

  // Shows the list remembered in this session at once and refreshes it in the background.
  const runSearch = useCallback(async (rut: string, from: string, to: string) => {
    if (!rut) return;
    const sequence = ++searchSequence.current;
    // Same shape as `context`, which the rendered selection keeps current.
    const requestContext = JSON.stringify([true, rut, from, to]);
    const isCurrent = () =>
      sequence === searchSequence.current && latestContext.current === requestContext;
    setDicomExam(null);
    setError(null);
    setRefreshError(null);
    // The exact and the check-digit searches, and the session memory, are one shared routine.
    const search = searchMmradStudies(
      { rut, patientName: patientNameOf(rut), dateFrom: from, dateTo: to },
      {
        isCurrent,
        onShown: shown => setResult(shown),
        // A failed refresh is not "no exams": the remembered list stays.
        onExactError: (message, remembered) =>
          remembered ? setRefreshError(message) : setError(message),
      }
    );
    setSearchMode(search.remembered ? 'background' : 'foreground');
    setResult(search.remembered ?? null);
    await search.done;
    if (sequence === searchSequence.current) setSearchMode(null);
  }, []);

  const handleSearch = useCallback(
    () => runSearch(selectedRut, dateFrom, dateTo),
    [runSearch, selectedRut, dateFrom, dateTo]
  );

  // Once per open: select the initial patient, show what this session remembers for it and refresh
  // it. Without a remembered list only an auto-search request searches by itself.
  React.useEffect(() => {
    if (!isOpen) {
      openedForRutRef.current = null;
      return;
    }
    const openedFor = initialPatientRut || '';
    if (openedForRutRef.current === openedFor) return;
    openedForRutRef.current = openedFor;
    const rut = initialPatientRut || selectedRut;
    setSelectedRut(rut);
    setError(null);
    setRefreshError(null);
    if (
      (autoSearchInitialPatient && initialPatientRut) ||
      readRememberedMMRADExams({ rut, dateFrom, dateTo })
    ) {
      void runSearch(rut, dateFrom, dateTo);
    } else {
      setResult(null);
    }
    // Only an open or a new initial patient restarts this; later choices go through the selector.
  }, [isOpen, initialPatientRut]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopyReport = useCallback(async (exam: MMRADExam) => {
    const reportText = exam.report
      ? buildMMRADReportClipboardText({
          examName: exam.nombre_examen,
          examDate: exam.fecha_examen,
          title: exam.report.title,
          findings: exam.report.findings,
          impression: exam.report.impression,
        })
      : null;
    if (!reportText) {
      return;
    }

    await writeClipboardText(reportText);
    const examKey = buildMMRADExamKey(exam);
    setCopiedReportExamKey(examKey);
    if (copiedReportResetTimeoutRef.current) {
      window.clearTimeout(copiedReportResetTimeoutRef.current);
    }
    copiedReportResetTimeoutRef.current = window.setTimeout(() => {
      setCopiedReportExamKey(currentKey => (currentKey === examKey ? null : currentKey));
      copiedReportResetTimeoutRef.current = null;
    }, 1800);
  }, []);

  const handleOpenPdf = useCallback(async (exam: MMRADExam) => {
    if (!exam.pdf_url || pdfOperation.current) return;
    const controller = new AbortController();
    pdfOperation.current = controller;
    try {
      await deliverMmradPdf(exam.pdf_url, controller, { print: true });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Error al abrir el PDF.');
    } finally {
      if (pdfOperation.current === controller) pdfOperation.current = null;
    }
  }, []);

  const handleOpenPortalReceipt = useCallback(async (exam: MMRADExam) => {
    if (!exam.portal_web_receipt_url) {
      return;
    }

    try {
      const receiptHtml = await fetchMMRADPortalReceiptHtml(exam.portal_web_receipt_url);
      setPortalReceiptPreview({
        title: 'Comprobante Portal Web paciente',
        html: buildMMRADPortalReceiptPrintHtml(receiptHtml),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Error al abrir el comprobante portal.');
    }
  }, []);

  const setDatePreset = (preset: 'last-month' | 'last-year' | 'last-5-years') => {
    const range = resolveMMRADDatePresetRange(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  React.useEffect(() => {
    if (!isOpen) {
      setPortalReceiptPreview(null);
      setDicomExam(null);
      searchSequence.current++;
      // The search still running finishes in the background and is remembered, unshown.
      setSearchMode(null);
    }
  }, [isOpen]);

  React.useEffect(() => {
    return () => {
      if (copiedReportResetTimeoutRef.current) {
        window.clearTimeout(copiedReportResetTimeoutRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        backdropZIndex={LAYER_Z_INDEX.modal}
        onClose={onClose}
        variant="white"
        size="3xl"
        className="!rounded-2xl ring-1 ring-black/[0.03]"
        bodyClassName="max-h-[85vh] overflow-y-auto px-5 py-4"
        title="Radiología / Imagenología"
        icon={<XRayIcon size={16} />}
        headerIconColor="text-violet-600"
        headerActions={
          onRequestImaging ? (
            <button
              type="button"
              onClick={onRequestImaging}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-[12px] font-semibold text-violet-700 transition-colors hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500"
            >
              <ClipboardPlus size={14} aria-hidden="true" />
              Solicitar imagen
            </button>
          ) : undefined
        }
      >
        <RadiologyViewerControls
          uniquePatients={uniquePatients}
          selectedRut={selectedRut}
          isLoading={isLoading}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onPatientChange={rut => {
            searchSequence.current++;
            setSearchMode(null);
            setDicomExam(null);
            setSelectedRut(rut);
            setResult(null);
            setError(null);
            setRefreshError(null);
            if (readRememberedMMRADExams({ rut, dateFrom, dateTo }))
              void runSearch(rut, dateFrom, dateTo);
          }}
          onSearch={handleSearch}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onSetDatePreset={setDatePreset}
          onClearDates={() => {
            setDateFrom('');
            setDateTo('');
          }}
        />

        <RadiologyViewerProgress progress={progress} />

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <RadiologyViewerResults
          result={result}
          isLoading={isForegroundLoading}
          modalities={modalities}
          activeModTab={activeModTab}
          filteredExams={filteredExams}
          onTabChange={setActiveModTab}
          onOpenPdf={handleOpenPdf}
          onOpenPortalReceipt={handleOpenPortalReceipt}
          onOpenDicom={exam => {
            if (result && normalizeDicomPatientId(result.rut) === normalizedRut) setDicomExam(exam);
          }}
          onCopyReport={handleCopyReport}
          copiedReportExamKey={copiedReportExamKey}
        />

        {/* Below the list, so a failed refresh never pushes it down. */}
        {result && refreshError && (
          <p role="status" className="mt-3 text-[11px] text-slate-500">
            No se pudo actualizar desde MMRAD ({refreshError}). Se muestra la última lista conocida.
          </p>
        )}

        {!result && !isLoading && !error && <RadiologyViewerEmptyState />}
      </BaseModal>
      {dicomExam?.dicom_url && result && normalizeDicomPatientId(result.rut) === normalizedRut && (
        <React.Suspense fallback={<p role="status">Cargando visor…</p>}>
          <DicomViewerDialog
            key={`${selectedRut}:${dicomExam.dicom_url}`}
            reviewCache={reviewCache}
            link={dicomExam.dicom_url}
            patientId={selectedRut}
            registeredPatientId={dicomExam.registered_patient_id}
            registeredPatientName={dicomExam.registered_patient_name}
            patientName={selectedPatientName}
            studyDate={dicomExam.fecha_examen}
            reportLink={dicomExam.pdf_url}
            title={dicomExam.nombre_examen}
            onClose={() => setDicomExam(null)}
            onCapture={onCapture}
          />
        </React.Suspense>
      )}
      {portalReceiptPreview && (
        <RadiologyPortalReceiptPreview
          title={portalReceiptPreview.title}
          html={portalReceiptPreview.html}
          onClose={() => setPortalReceiptPreview(null)}
        />
      )}
    </>
  );
};
