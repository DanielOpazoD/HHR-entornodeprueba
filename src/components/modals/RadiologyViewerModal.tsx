import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useDicomReviewCache } from '@/components/radiology/useDicomReviewCache';
import { Radio } from 'lucide-react';
import { LAYER_Z_INDEX } from '@/shared/ui/layering';
import { normalizeDicomPatientId, type DicomCapture } from '@/services/radiology/dicomTypes';
import { BaseModal } from '@/components/shared/BaseModal';
import {
  fetchMMRADPdfBlobUrl,
  fetchMMRADPortalReceiptHtml,
  searchMMRADCheckDigitExams,
  searchMMRADExams,
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
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import {
  buildFilteredMMRADExams,
  buildMMRADExamKey,
  buildUniqueRadiologyPatients,
  extractMMRADModalities,
  resolveInitialMMRADModalityTab,
  resolveMMRADDatePresetRange,
} from '@/components/modals/controllers/radiologyViewerModalController';
import {
  openMMRADExamListMemory,
  readRememberedMMRADExams,
} from '@/components/modals/controllers/radiologyExamListMemory';

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
      { pct: 10, text: 'Conectando con el servidor de imágenes...' },
      { pct: 30, text: 'Iniciando sesión en RIS MMRAD...' },
      { pct: 50, text: 'Buscando exámenes del paciente...' },
      { pct: 70, text: 'Extrayendo informes y enlaces...' },
      { pct: 85, text: 'Procesando resultados...' },
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
            ? { pct: Math.min(prev.pct + 1, 95), text: 'Finalizando consulta...' }
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
    const memory = openMMRADExamListMemory({ rut, dateFrom: from, dateTo: to });
    setDicomExam(null);
    setSearchMode(memory.remembered ? 'background' : 'foreground');
    setError(null);
    setRefreshError(null);
    setResult(memory.remembered ?? null);

    const query = { rut, dateFrom: from || undefined, dateTo: to || undefined };
    const show = (data: MMRADSearchResult) => {
      const shown = memory.remember(data);
      if (shown && isCurrent()) setResult(shown);
    };
    // Exams MMRAD registered with a mistyped check digit come from a slower request that runs at
    // the same time; they join the list when they arrive (see mmrad-search).
    const patientName = patientNameOf(rut);
    if (patientName)
      void searchMMRADCheckDigitExams({ ...query, patientName }).then(
        data => {
          if (normalizeDicomPatientId(data.rut) === normalizeDicomPatientId(rut)) show(data);
        },
        () => show({ rut, examenes: [], check_digit_search: 'partial' })
      );

    try {
      show(await searchMMRADExams(query));
    } catch (err) {
      if (isCurrent()) {
        const message = err instanceof Error ? err.message : 'Error al buscar exámenes';
        // A failed refresh is not "no exams": the remembered list stays.
        if (memory.remembered) setRefreshError(message);
        else setError(message);
      }
    } finally {
      if (sequence === searchSequence.current) setSearchMode(null);
    }
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
    if (!exam.pdf_url) {
      return;
    }

    const popupWindow = defaultBrowserWindowRuntime.open('', '_blank');
    if (!popupWindow) {
      return;
    }

    try {
      const pdfUrl = await fetchMMRADPdfBlobUrl(exam.pdf_url);
      popupWindow.location.href = pdfUrl;
      popupWindow.focus();
      window.setTimeout(() => {
        try {
          popupWindow.focus();
          popupWindow.print();
        } catch {
          // Ignore popup cross-origin print limitations.
        }
      }, 1500);
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
    } catch (error) {
      popupWindow.close();
      setError(error instanceof Error ? error.message : 'Error al abrir el PDF.');
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
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 text-white shadow-md shadow-violet-500/20">
              <Radio size={16} />
            </span>
            <span className="text-[15px] font-bold tracking-tight text-slate-800">
              Radiología / Imagenología
            </span>
          </span>
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
