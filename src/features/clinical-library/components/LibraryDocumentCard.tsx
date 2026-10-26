import React from 'react';
import { Download, FilePenLine, FileText, Image, Printer } from 'lucide-react';
import type { LibraryDocumentEntry, LibraryDocumentFormat } from '../domain/libraryCatalogTypes';
import { toLibraryDocumentHref } from '../services/libraryDocumentActions';
import { documentFormatLabel } from '../controllers/libraryPresentation';

const FORMAT_ICONS: Readonly<Record<LibraryDocumentFormat, React.ReactNode>> = {
  pdf: <FileText size={16} aria-hidden="true" />,
  docx: <FileText size={16} aria-hidden="true" />,
  image: <Image size={16} aria-hidden="true" />,
};

const ACTION_CLASS =
  'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-medical-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical-500';

interface LibraryDocumentCardProps {
  entry: LibraryDocumentEntry;
  onPrint: (entry: LibraryDocumentEntry) => void;
  onFill?: (entry: LibraryDocumentEntry) => void;
}

/** Fila plana: título completo, formato junto a él y una acción explícita. */
export const LibraryDocumentCard: React.FC<LibraryDocumentCardProps> = ({
  entry,
  onPrint,
  onFill,
}) => (
  <li
    data-testid={`library-document-${entry.id}`}
    className="flex min-h-11 items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-slate-50 focus-within:bg-slate-50"
  >
    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
      {FORMAT_ICONS[entry.format]}
    </span>
    <div className="min-w-0 flex-1">
      <p
        className="break-words text-[12px] font-medium leading-snug text-slate-800"
        title={entry.title}
      >
        {entry.title}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {documentFormatLabel(entry.format, entry.pages)}
      </p>
    </div>
    {entry.editorId && onFill && (
      <button
        type="button"
        className={ACTION_CLASS}
        onClick={() => onFill(entry)}
        aria-label={`Completar ${entry.title}`}
        title="Completar formulario"
      >
        <FilePenLine size={16} aria-hidden="true" />
        <span>Completar</span>
      </button>
    )}
    {entry.format === 'docx' ? (
      <a
        href={toLibraryDocumentHref(entry.url)}
        download
        aria-label={`Descargar ${entry.title}`}
        title="Descargar Word"
        className={ACTION_CLASS}
      >
        <Download size={16} aria-hidden="true" />
        {!entry.editorId && <span>Descargar</span>}
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
        {!entry.editorId && <span>Imprimir</span>}
      </button>
    )}
  </li>
);
