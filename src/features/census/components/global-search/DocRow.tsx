/**
 * DocRow
 *
 * Renders a single clinical document row with type, date, author,
 * and actions to open the clinical documents viewer or PDF preview.
 */

import React, { useCallback, useState } from 'react';
import { FileText, ExternalLink, Loader2 } from 'lucide-react';
import type { ClinicalDocSummary } from '@/features/census/components/global-search/globalSearchContracts';
import { formatDateToCL } from '@/utils/clinicalUtils';

interface DocRowProps {
  doc: ClinicalDocSummary;
  onDownloadPdf: (docId: string, docType: string) => Promise<void>;
  onOpenDocument?: (doc: ClinicalDocSummary) => void;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  epicrisis: 'Epicrisis',
  epicrisis_traslado: 'Epicrisis de traslado',
  informe: 'Informe',
  informe_clinico: 'Informe clinico',
};

const formatDocType = (type: string): string => {
  const normalized = type.trim().toLowerCase();
  if (DOCUMENT_TYPE_LABELS[normalized]) return DOCUMENT_TYPE_LABELS[normalized];
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

export const DocRow: React.FC<DocRowProps> = ({ doc, onDownloadPdf, onOpenDocument }) => {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    setIsDownloading(true);
    try {
      await onDownloadPdf(doc.id, doc.documentType);
    } finally {
      setIsDownloading(false);
    }
  }, [doc.id, doc.documentType, onDownloadPdf]);

  const handleOpenDocument = useCallback(() => {
    onOpenDocument?.(doc);
  }, [doc, onOpenDocument]);

  const dateDisplay = doc.updatedAt ? formatDateToCL(doc.updatedAt.split('T')[0]) : '';
  const docTypeLabel = formatDocType(doc.documentType);

  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <FileText size={12} className="text-slate-400 shrink-0" />
      <button
        type="button"
        onClick={handleOpenDocument}
        disabled={!onOpenDocument}
        className="flex-1 min-w-0 text-left rounded-sm transition-colors enabled:hover:text-medical-700 disabled:cursor-default"
        title={onOpenDocument ? `Abrir ${docTypeLabel}` : undefined}
      >
        <span className="text-xs font-medium text-slate-700 block truncate">{docTypeLabel}</span>
        <span className="text-[10px] text-slate-400">
          {dateDisplay}
          {doc.createdBy ? ` · ${doc.createdBy}` : ''}
        </span>
      </button>
      <button
        type="button"
        onClick={handleDownload}
        disabled={isDownloading}
        className="shrink-0 p-1.5 rounded-md text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors disabled:opacity-50"
        title="Ver PDF"
      >
        {isDownloading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <ExternalLink size={16} />
        )}
      </button>
    </div>
  );
};
