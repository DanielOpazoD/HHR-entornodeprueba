import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Radio } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import {
  fetchMMRADPdfBlobUrl,
  fetchMMRADPortalReceiptHtml,
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

interface RadiologyViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  patients: RadiologyPatient[];
  initialPatientRut?: string;
  autoSearchInitialPatient?: boolean;
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
}) => {
  const [selectedRut, setSelectedRut] = useState(initialPatientRut || patients[0]?.rut || '');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<MMRADSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const autoSearchedRutRef = useRef<string | null>(null);

  const uniquePatients = useMemo(() => buildUniqueRadiologyPatients(patients), [patients]);

  const modalities = useMemo(
    () => (result ? extractMMRADModalities(result.examenes) : []),
    [result]
  );

  const filteredExams = useMemo(
    () => buildFilteredMMRADExams(result, activeModTab),
    [result, activeModTab]
  );

  React.useEffect(() => {
    setActiveModTab(resolveInitialMMRADModalityTab(modalities));
  }, [result, modalities]);

  /**
   * Simulated progress bar.
   */
  React.useEffect(() => {
    if (!isLoading) {
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
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback(async () => {
    if (!selectedRut) return;
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await searchMMRADExams({
        rut: selectedRut,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al buscar exámenes');
    } finally {
      setIsLoading(false);
    }
  }, [selectedRut, dateFrom, dateTo]);

  React.useEffect(() => {
    if (!isOpen) {
      autoSearchedRutRef.current = null;
      return;
    }

    if (
      !autoSearchInitialPatient ||
      !initialPatientRut ||
      selectedRut !== initialPatientRut ||
      autoSearchedRutRef.current === initialPatientRut
    ) {
      return;
    }

    autoSearchedRutRef.current = initialPatientRut;
    void handleSearch();
  }, [autoSearchInitialPatient, handleSearch, initialPatientRut, isOpen, selectedRut]);

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
    if (isOpen && initialPatientRut) {
      setSelectedRut(initialPatientRut);
      setResult(null);
      setError(null);
    }
  }, [isOpen, initialPatientRut]);

  React.useEffect(() => {
    if (!isOpen) {
      setPortalReceiptPreview(null);
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
            setSelectedRut(rut);
            setResult(null);
            setError(null);
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
          isLoading={isLoading}
          modalities={modalities}
          activeModTab={activeModTab}
          filteredExams={filteredExams}
          onTabChange={setActiveModTab}
          onOpenPdf={handleOpenPdf}
          onOpenPortalReceipt={handleOpenPortalReceipt}
          onCopyReport={handleCopyReport}
          copiedReportExamKey={copiedReportExamKey}
        />

        {!result && !isLoading && !error && <RadiologyViewerEmptyState />}
      </BaseModal>
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
