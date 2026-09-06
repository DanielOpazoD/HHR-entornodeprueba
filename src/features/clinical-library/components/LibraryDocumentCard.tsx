import React from 'react';
import { FileText, Image, Printer } from 'lucide-react';
import type { LibraryDocumentEntry, LibraryDocumentFormat } from '../domain/libraryCatalogTypes';
import { formatDocumentSize } from '../controllers/libraryPresentation';

const FORMAT_ICONS: Readonly<Record<LibraryDocumentFormat, React.ReactNode>> = {
  pdf: <FileText size={16} aria-hidden="true" />,
  docx: <FileText size={16} aria-hidden="true" />,
  image: <Image size={16} aria-hidden="true" />,
};

interface LibraryDocumentCardProps {
  entry: LibraryDocumentEntry;
  onPrint: (entry: LibraryDocumentEntry) => void;
}

/** Fila plana: icono, título, tamaño e impresión. */
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
    <button
      type="button"
      onClick={() => onPrint(entry)}
      aria-label={`Imprimir ${entry.title}`}
      title="Imprimir"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-medical-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600"
    >
      <Printer size={16} aria-hidden="true" />
    </button>
  </li>
);
