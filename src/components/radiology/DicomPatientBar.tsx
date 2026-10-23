import React, { useEffect, useRef, useState } from 'react';
import { FileDown } from 'lucide-react';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { buildMMRADPdfUrl } from '@/services/radiology/mmradService';

export const DicomPatientBar: React.FC<{
  patientId: string;
  patientName?: string;
  date?: string;
  reportLink?: string | null;
}> = ({ patientId, patientName, date, reportLink }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
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
  const download = async () => {
    if (!reportLink || busy) return;
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
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'informe-mmrad.pdf';
      anchor.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }, 60_000);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const formattedDate = date?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$3/$2/$1');
  return (
    <div className="dicom-patient-bar">
      {patientName && <strong>{patientName}</strong>}
      <span>{patientId}</span>
      {formattedDate && <time>{formattedDate}</time>}
      {reportLink && (
        <button
          type="button"
          aria-label="Descargar informe MMRAD"
          title="Descargar informe MMRAD"
          disabled={busy}
          onClick={() => void download()}
        >
          <FileDown size={15} />
          {busy ? '…' : 'Informe'}
        </button>
      )}
      {error && <span role="alert">No se pudo descargar el informe.</span>}
    </div>
  );
};
