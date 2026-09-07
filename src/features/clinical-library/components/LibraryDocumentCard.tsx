import React from 'react';
import { Download, FileText, Image, Printer } from 'lucide-react';
import type { LibraryDocumentEntry, LibraryDocumentFormat } from '../domain/libraryCatalogTypes';
import { toLibraryDocumentHref } from '../services/libraryDocumentActions';
import { formatDocumentSize } from '../controllers/libraryPresentation';

const FORMAT_ICONS: Readonly<Record<LibraryDocumentFormat, React.ReactNode>> = {
  pdf: <FileText size={16} aria-hidden="true" />,
  docx: <FileText size={16} aria-hidden="true" />,
  image: <Image size={16} aria-hidden="true" />,
};

const ACTION_CLASS =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-medical-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600';

interface LibraryDocumentCardProps {
  entry: LibraryDocumentEntry;
  onPrint: (entry: LibraryDocumentEntry) => void;
}

/** Fila plana: icono, título, tamaño y una sola acción (imprimir; descargar si es Word). */
export const LibraryDocumentCard: React.FC<LibraryDocumentCardProps> = ({ entry, onPrint }) => (
  <li data-testid={`library-document-${entry.id}`} className="flex items-center gap-3 py-2">
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500">
      {FORMAT_ICONS[entry.format]}
    </span>
    <p className="min-w-0 flex-1 truncate text-[13px] text-slate-800" title={entry.title}>
      {entry.title}
    </p>
    <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
      {formatDocumentSize(entry.sizeKb)}
    </span>
    {entry.format === 'docx' ? (
      <a
        href={toLibraryDocumentHref(entry.url)}
        download
        aria-label={`Descargar ${entry.title}`}
        title="Descargar (Word)"
        className={ACTION_CLASS}
      >
        <Download size={16} aria-hidden="true" />
      </a>
    ) : (
      <button
        type="button"
        onClick={() => onPrint(entry)}
        aria-label={`Imprimir ${entry.title}`}
        title="Imprimir"
        className={ACTION_CLASS}
      >
        <Printer size={16} aria-hidden="true" />
      </button>
    )}
  </li>
);
