import React from 'react';
import clsx from 'clsx';
import { Download, ExternalLink, Printer } from 'lucide-react';
import type { LibraryDocumentEntry } from '../domain/libraryCatalogTypes';
import { toLibraryDocumentHref } from '../services/libraryDocumentActions';
import {
  DOCUMENT_FORMAT_BADGES,
  documentFileName,
  documentPagesLabel,
  formatDocumentSize,
} from '../controllers/libraryPresentation';

const ACTION_CLASS =
  'inline-flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-medical-300 hover:bg-medical-50 hover:text-medical-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600';

interface LibraryDocumentCardProps {
  entry: LibraryDocumentEntry;
  onOpen: (entry: LibraryDocumentEntry) => void;
  onPrint: (entry: LibraryDocumentEntry) => void;
}

/** Una fila por documento: formato, título y tamaño a la izquierda; acciones a la derecha. */
export const LibraryDocumentCard: React.FC<LibraryDocumentCardProps> = ({
  entry,
  onOpen,
  onPrint,
}) => {
  const badge = DOCUMENT_FORMAT_BADGES[entry.format];
  const printable = entry.format !== 'docx';
  const meta = [documentPagesLabel(entry.pages), formatDocumentSize(entry.sizeKb)]
    .filter(Boolean)
    .join(' · ');

  return (
    <li
      data-testid={`library-document-${entry.id}`}
      className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2"
    >
      <span
        className={clsx(
          'inline-flex h-6 w-12 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold tracking-wide',
          badge.className
        )}
        title={badge.hint}
      >
        {badge.label}
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-800">
          {entry.title}
        </h4>
        <p className="text-[10px] tabular-nums text-slate-400">{meta}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label={entry.title}>
        {printable && (
          <button
            type="button"
            onClick={() => onOpen(entry)}
            className={ACTION_CLASS}
            aria-label="Abrir"
            title="Abrir"
          >
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        )}
        {printable && (
          <button
            type="button"
            onClick={() => onPrint(entry)}
            className={ACTION_CLASS}
            aria-label="Imprimir"
            title="Imprimir"
          >
            <Printer size={14} aria-hidden="true" />
          </button>
        )}
        <a
          href={toLibraryDocumentHref(entry.url)}
          download={documentFileName(entry.url)}
          className={ACTION_CLASS}
          aria-label="Descargar"
          title="Descargar"
        >
          <Download size={14} aria-hidden="true" />
        </a>
      </div>
    </li>
  );
};
