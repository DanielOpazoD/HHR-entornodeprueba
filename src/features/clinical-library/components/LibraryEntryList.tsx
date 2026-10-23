import React from 'react';
import { ChevronRight } from 'lucide-react';
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
import { TOOL_REGISTRY } from './toolRegistry';

const LibraryToolRow: React.FC<{
  entry: LibraryToolEntry;
  onOpen: (id: LibraryToolId) => void;
}> = ({ entry, onOpen }) => (
  <li>
    <button
      type="button"
      data-testid={`library-tool-${entry.id}`}
      onClick={() => onOpen(entry.id)}
      className="group flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical-500"
    >
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-medical-50 text-medical-700 [&>svg]:size-4">
        {TOOL_REGISTRY[entry.id].icon}
      </span>
      <span className="min-w-0 flex-1 text-[12px] font-medium leading-snug text-slate-800 group-hover:text-medical-800">
        {entry.title}
      </span>
      <ChevronRight
        size={16}
        className="shrink-0 text-slate-300 transition-colors group-hover:text-medical-600"
        aria-hidden="true"
      />
    </button>
  </li>
);

interface LibraryEntryListProps {
  entries: ReadonlyArray<LibraryEntry>;
  category: LibraryCategoryFilter;
  query: string;
  onOpenTool: (id: LibraryToolId) => void;
  onPrintDocument: (entry: LibraryDocumentEntry) => void;
  onFillDocument?: (entry: LibraryDocumentEntry) => void;
}

export const LibraryEntryList: React.FC<LibraryEntryListProps> = ({
  entries,
  category,
  query,
  onOpenTool,
  onPrintDocument,
  onFillDocument,
}) => {
  const trimmedQuery = query.trim();
  const groups = groupLibraryEntriesByCategory(
    entries,
    category === 'all' ? LIBRARY_CATEGORY_IDS : [category]
  );
  const visibleGroups =
    category === 'all' || trimmedQuery ? groups.filter(group => group.entries.length > 0) : groups;

  if (visibleGroups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-[12px] leading-relaxed text-slate-500">
        {trimmedQuery ? `Sin resultados para «${trimmedQuery}»` : 'No hay documentos disponibles.'}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {visibleGroups.map(group => {
        const meta = findLibraryCategory(group.category);
        const headingId = `library-group-${group.category}`;
        return (
          <section key={group.category} aria-labelledby={headingId}>
            <h3
              id={headingId}
              className="mb-1.5 border-b border-slate-200 px-2 pb-2 text-[11px] font-semibold text-slate-500"
            >
              {meta.label}
            </h3>
            {group.entries.length === 0 ? (
              <p className="px-2 py-3 text-[12px] leading-relaxed text-slate-500">
                {meta.emptyTitle}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {group.entries.map(entry =>
                  entry.kind === 'tool' ? (
                    <LibraryToolRow key={entry.id} entry={entry} onOpen={onOpenTool} />
                  ) : (
                    <LibraryDocumentCard
                      key={entry.id}
                      entry={entry}
                      onPrint={onPrintDocument}
                      onFill={onFillDocument}
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
