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
      className="group flex w-full items-center gap-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600"
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-medical-700">
        {TOOL_REGISTRY[entry.id].icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800 group-hover:text-medical-800">
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
}

export const LibraryEntryList: React.FC<LibraryEntryListProps> = ({
  entries,
  category,
  query,
  onOpenTool,
  onPrintDocument,
}) => {
  const trimmedQuery = query.trim();
  const groups = groupLibraryEntriesByCategory(
    entries,
    category === 'all' ? LIBRARY_CATEGORY_IDS : [category]
  );
  const visibleGroups = trimmedQuery ? groups.filter(group => group.entries.length > 0) : groups;

  if (visibleGroups.length === 0) {
    return (
      <p className="py-8 text-center text-[12px] text-slate-500">
        Sin resultados para «{trimmedQuery}»
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
              className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400"
            >
              {meta.label}
            </h3>
            {group.entries.length === 0 ? (
              <p className="py-3 text-[12px] text-slate-400">{meta.emptyTitle}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {group.entries.map(entry =>
                  entry.kind === 'tool' ? (
                    <LibraryToolRow key={entry.id} entry={entry} onOpen={onOpenTool} />
                  ) : (
                    <LibraryDocumentCard key={entry.id} entry={entry} onPrint={onPrintDocument} />
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
