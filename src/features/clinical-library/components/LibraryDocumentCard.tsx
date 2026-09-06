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
} from './libraryPresentation';

const ACTION_CLASS =
  'inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600';

interface LibraryDocumentCardProps {
  entry: LibraryDocumentEntry;
  onOpen: (entry: LibraryDocumentEntry) => void;
  onPrint: (entry: LibraryDocumentEntry) => void;
}

export const LibraryDocumentCard: React.FC<LibraryDocumentCardProps> = ({
  entry,
  onOpen,
  onPrint,
}) => {
  const badge = DOCUMENT_FORMAT_BADGES[entry.format];
  const printable = entry.format !== 'docx';
  const meta = [documentPagesLabel(entry.pages), formatDocumentSize(entry.sizeKb), entry.source]
    .filter(Boolean)
    .join(' · ');

  return (
    <li
      data-testid={`library-document-${entry.id}`}
      className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
    >
      <div className="flex items-start gap-2.5">
        <span
          className={clsx(
            'mt-0.5 inline-flex h-6 shrink-0 items-center rounded-md border px-1.5 text-[10px] font-bold tracking-wide',
            badge.className
          )}
          title={badge.hint}
        >
          {badge.label}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-[13px] font-semibold leading-snug text-slate-800">{entry.title}</h4>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{entry.description}</p>
          <p className="mt-1 text-[10px] tabular-nums text-slate-400">{meta}</p>
        </div>
      </div>
      <div
        className="mt-2 flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label={`Acciones de ${entry.title}`}
      >
        {printable && (
          <button type="button" onClick={() => onOpen(entry)} className={ACTION_CLASS}>
            <ExternalLink size={12} aria-hidden="true" />
            Abrir
          </button>
        )}
        {printable && (
          <button type="button" onClick={() => onPrint(entry)} className={ACTION_CLASS}>
            <Printer size={12} aria-hidden="true" />
            Imprimir
          </button>
        )}
        <a
          href={toLibraryDocumentHref(entry.url)}
          download={documentFileName(entry.url)}
          className={ACTION_CLASS}
        >
          <Download size={12} aria-hidden="true" />
          Descargar
        </a>
        {!printable && <span className="text-[10px] text-slate-400">{badge.hint}</span>}
      </div>
    </li>
  );
};
