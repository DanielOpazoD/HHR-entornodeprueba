import React from 'react';
import { Download, FileText, Image, Printer } from 'lucide-react';
import type { LibraryDocumentEntry, LibraryDocumentFormat } from '../domain/libraryCatalogTypes';
import { toLibraryDocumentHref } from '../services/libraryDocumentActions';
import { documentFormatLabel } from '../controllers/libraryPresentation';

const FORMAT_ICONS: Readonly<Record<LibraryDocumentFormat, React.ReactNode>> = {
  pdf: <FileText size={16} aria-hidden="true" />,
  docx: <FileText size={16} aria-hidden="true" />,
  image: <Image size={16} aria-hidden="true" />,
};

const ACTION_CLASS =
  'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-medical-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600';

interface LibraryDocumentCardProps {
  entry: LibraryDocumentEntry;
  onPrint: (entry: LibraryDocumentEntry) => void;
}

/** Fila plana: título en dos líneas, formato junto a él y una acción explícita. */
export const LibraryDocumentCard: React.FC<LibraryDocumentCardProps> = ({ entry, onPrint }) => (
  <li data-testid={`library-document-${entry.id}`} className="flex items-center gap-2.5 py-1.5">
    <span className="inline-flex size-5 shrink-0 items-center justify-center text-slate-400">
      {FORMAT_ICONS[entry.format]}
    </span>
    <div className="min-w-0 flex-1">
      <p className="line-clamp-2 text-[13px] leading-snug text-slate-800" title={entry.title}>
        {entry.title}
      </p>
      <p className="mt-0.5 text-[10px] text-slate-500">
        {documentFormatLabel(entry.format, entry.pages)}
      </p>
    </div>
    {entry.format === 'docx' ? (
      <a
        href={toLibraryDocumentHref(entry.url)}
        download
        aria-label={`Descargar ${entry.title}`}
        title="Descargar Word"
        className={ACTION_CLASS}
      >
        <Download size={16} aria-hidden="true" />
        <span>Descargar</span>
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
        <span>Imprimir</span>
      </button>
    )}
  </li>
);
