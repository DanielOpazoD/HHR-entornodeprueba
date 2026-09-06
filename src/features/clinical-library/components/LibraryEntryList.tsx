import React from 'react';
import { Calculator, ChevronRight, FolderOpen, ListChecks, Syringe } from 'lucide-react';
import { findLibraryCategory } from '../domain/libraryCatalog';
import {
  LIBRARY_CATEGORY_IDS,
  type LibraryDocumentEntry,
  type LibraryEntry,
  type LibraryToolEntry,
  type LibraryToolId,
} from '../domain/libraryCatalogTypes';
import { groupLibraryEntriesByCategory, type LibraryCategoryFilter } from '../domain/librarySearch';
import { LibraryDocumentCard } from './LibraryDocumentCard';

const TOOL_ICONS: Readonly<Record<LibraryToolId, React.ReactNode>> = {
  infusion: <Syringe size={16} aria-hidden="true" />,
  dosing: <Calculator size={16} aria-hidden="true" />,
  scores: <ListChecks size={16} aria-hidden="true" />,
};

const LibraryToolCard: React.FC<{
  entry: LibraryToolEntry;
  onOpen: (id: LibraryToolId) => void;
}> = ({ entry, onOpen }) => (
  <li>
    <button
      type="button"
      data-testid={`library-tool-${entry.id}`}
      onClick={() => onOpen(entry.id)}
      className="group flex w-full items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 transition-colors group-hover:bg-teal-100">
        {TOOL_ICONS[entry.id]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-snug text-slate-800">
          {entry.title}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
          {entry.description}
        </span>
      </span>
      <ChevronRight
        size={16}
        className="mt-1 shrink-0 text-slate-300 transition-colors group-hover:text-teal-600"
        aria-hidden="true"
      />
    </button>
  </li>
);

const EmptyState: React.FC<{ title: string; detail: string }> = ({ title, detail }) => (
  <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center">
    <FolderOpen className="mx-auto text-slate-300" size={22} aria-hidden="true" />
    <p className="mt-2 text-[12px] font-semibold text-slate-700">{title}</p>
    <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
  </div>
);

interface LibraryEntryListProps {
  entries: ReadonlyArray<LibraryEntry>;
  category: LibraryCategoryFilter;
  query: string;
  onOpenTool: (id: LibraryToolId) => void;
  onOpenDocument: (entry: LibraryDocumentEntry) => void;
  onPrintDocument: (entry: LibraryDocumentEntry) => void;
}

export const LibraryEntryList: React.FC<LibraryEntryListProps> = ({
  entries,
  category,
  query,
  onOpenTool,
  onOpenDocument,
  onPrintDocument,
}) => {
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const groups = groupLibraryEntriesByCategory(
    entries,
    category === 'all' ? LIBRARY_CATEGORY_IDS : [category]
  );
  const visibleGroups = hasQuery ? groups.filter(group => group.entries.length > 0) : groups;

  if (visibleGroups.length === 0) {
    return (
      <EmptyState
        title={`Sin resultados para «${trimmedQuery}»`}
        detail="Prueba con otra palabra: nombre del documento, examen, fármaco o score."
      />
    );
  }

  return (
    <div className="space-y-4">
      {visibleGroups.map(group => {
        const meta = findLibraryCategory(group.category);
        const headingId = `library-group-${group.category}`;
        return (
          <section key={group.category} aria-labelledby={headingId}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <h3
                id={headingId}
                className="text-[11px] font-bold uppercase tracking-wide text-slate-500"
              >
                {meta.label}
              </h3>
              <span className="text-[10px] tabular-nums text-slate-400">
                {group.entries.length}
              </span>
            </div>
            {!hasQuery && <p className="mb-2 text-[11px] text-slate-500">{meta.description}</p>}
            {group.entries.length === 0 ? (
              <EmptyState title={meta.emptyTitle} detail={meta.emptyDetail} />
            ) : (
              <ul className="space-y-2">
                {group.entries.map(entry =>
                  entry.kind === 'tool' ? (
                    <LibraryToolCard key={entry.id} entry={entry} onOpen={onOpenTool} />
                  ) : (
                    <LibraryDocumentCard
                      key={entry.id}
                      entry={entry}
                      onOpen={onOpenDocument}
                      onPrint={onPrintDocument}
                    />
                  )
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
};
