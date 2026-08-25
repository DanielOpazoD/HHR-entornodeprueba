import React from 'react';
import { CheckCircle2, FileDown } from 'lucide-react';
import type { SyslabPdfDownloadStatus } from '@/types/domain/labExamTypes';

interface LabViewerPdfDownloadStatusProps {
  status: SyslabPdfDownloadStatus;
}

const statusText = (status: SyslabPdfDownloadStatus): string => {
  if (status.phase === 'success' && status.legacyExtension) {
    return `PDF descargado · ${status.total} informe${status.total === 1 ? '' : 's'}. Recarga la extensión Eloísa para aplicar el nombre nuevo y mostrar el total de páginas.`;
  }
  if (status.phase === 'success') {
    return `PDF creado correctamente · ${status.total} informe${status.total === 1 ? '' : 's'} · ${status.pageCount} página${status.pageCount === 1 ? '' : 's'}`;
  }
  if (status.phase === 'merging') {
    return `Combinando ${status.total} informes · ${status.pageCount} páginas`;
  }
  if (status.phase === 'downloading') return 'Guardando el PDF combinado…';
  const next = Math.min(status.completed + 1, status.total);
  return `Validando informe ${next} de ${status.total} · ${status.pageCount} páginas preparadas`;
};

export const LabViewerPdfDownloadStatus: React.FC<LabViewerPdfDownloadStatusProps> = ({
  status,
}) => {
  const success = status.phase === 'success';
  const progress = status.total > 0 ? Math.round((status.completed / status.total) * 100) : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-lg border px-3 py-2 ${
        success
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-sky-200 bg-sky-50 text-sky-800'
      }`}
    >
      <div className="flex items-center gap-2 text-[12px] font-semibold">
        {success ? <CheckCircle2 size={15} /> : <FileDown size={15} />}
        <span>{statusText(status)}</span>
      </div>
      {!success ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/80">
          <div
            className="h-full rounded-full bg-sky-500 transition-[width] duration-300"
            style={{ width: `${status.phase === 'downloading' ? 100 : progress}%` }}
          />
        </div>
      ) : null}
      {success && status.filename && !status.legacyExtension ? (
        <p
          className="mt-1 truncate text-[11px] font-medium text-emerald-700"
          title={status.filename}
        >
          {status.filename}
        </p>
      ) : null}
    </div>
  );
};
