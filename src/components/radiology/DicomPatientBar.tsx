import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, FileText, X } from 'lucide-react';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { buildMMRADPdfUrl } from '@/services/radiology/mmradService';
import { formatDicomStudyDate } from '@/services/radiology/dicomTypes';

const ReportPreview: React.FC<{ url: string; close: () => void }> = ({ url, close }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const current = dialog.current;
    current?.showModal();
    return () => current?.close();
  }, []);
  const dismiss = () => {
    dialog.current?.close();
    close();
  };
  return (
    <dialog
      ref={dialog}
      role="dialog"
      className="dicom-report-preview"
      aria-label="Informe MMRAD"
      onCancel={event => {
        event.preventDefault();
        dismiss();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }
      }}
    >
      <div className="dicom-report-header">
        <strong>Informe</strong>
        <a href={url} download="informe-mmrad.pdf" aria-label="Descargar PDF" title="Descargar PDF">
          <Download size={16} />
        </a>
        <button type="button" onClick={dismiss} aria-label="Cerrar informe" title="Cerrar informe">
          <X size={16} />
        </button>
      </div>
      <iframe src={url} title="PDF del informe MMRAD" />
    </dialog>
  );
};

export const DicomPatientBar: React.FC<{
  patientId: string;
  patientName?: string;
  date?: string;
  reportLink?: string | null;
}> = ({ patientId, patientName, date, reportLink }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const reportButton = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | undefined>(undefined);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const currentUrls = urls.current;
    return () => {
      request.current?.abort();
      currentUrls.forEach(url => URL.revokeObjectURL(url));
      currentUrls.clear();
    };
  }, [patientId, reportLink]);
  const closeReport = () => {
    if (reportUrl) {
      URL.revokeObjectURL(reportUrl);
      urls.current.delete(reportUrl);
    }
    setReportUrl(null);
    reportButton.current?.focus();
  };
  const openReport = async () => {
    if (!reportLink || busy) return;
    if (reportUrl) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(false);
    try {
      const headers = await resolveCurrentUserAuthHeaders();
      controller.signal.throwIfAborted();
      const response = await fetch(buildMMRADPdfUrl(reportLink), {
        headers,
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Informe no disponible');
      const blob = await response.blob();
      controller.signal.throwIfAborted();
      if (!blob.type.includes('application/pdf')) throw new Error('Formato no válido');
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      setReportUrl(url);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const formattedDate = formatDicomStudyDate(date);
  return (
    <div className="dicom-patient-bar">
      {patientName && <strong>{patientName}</strong>}
      <span>{patientId}</span>
      {formattedDate && <time>{formattedDate}</time>}
      {reportLink && (
        <button
          ref={reportButton}
          type="button"
          aria-label="Ver informe MMRAD"
          title="Ver informe MMRAD"
          disabled={busy}
          onClick={() => void openReport()}
        >
          <FileText size={15} />
          {busy ? '…' : 'Informe'}
        </button>
      )}
      {error && <span role="alert">No se pudo abrir el informe.</span>}
      {reportUrl && <ReportPreview url={reportUrl} close={closeReport} />}
    </div>
  );
};
