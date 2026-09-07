/**
 * Panel lateral «Documentos» del censo: catálogo estático (sin Firestore ni datos de
 * pacientes) con formularios, protocolos, infografías y herramientas sin conexión.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { FolderOpen, Search, X } from 'lucide-react';
import { LAYER_Z_INDEX } from '@/shared/ui/layering';
import { CLINICAL_LIBRARY_ENTRIES, LIBRARY_CATEGORIES } from '../domain/libraryCatalog';
import type { LibraryDocumentEntry, LibraryToolId } from '../domain/libraryCatalogTypes';
import { filterLibraryEntries, type LibraryCategoryFilter } from '../domain/librarySearch';
import { printLibraryDocument } from '../services/libraryDocumentActions';
import { LibraryEntryList } from './LibraryEntryList';
import { TOOL_REGISTRY } from './toolRegistry';

export interface LibraryDocumentActions {
  print: (entry: LibraryDocumentEntry) => void;
}

const DEFAULT_DOCUMENT_ACTIONS: LibraryDocumentActions = {
  print: entry => {
    printLibraryDocument(entry.url);
  },
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

interface ClinicalLibraryDrawerProps {
  onClose: () => void;
  initialToolId?: LibraryToolId | null;
  documentActions?: LibraryDocumentActions;
}

export const ClinicalLibraryDrawer: React.FC<ClinicalLibraryDrawerProps> = ({
  onClose,
  initialToolId = null,
  documentActions = DEFAULT_DOCUMENT_ACTIONS,
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<LibraryCategoryFilter>('all');
  const [activeToolId, setActiveToolId] = useState<LibraryToolId | null>(initialToolId);
  const searchRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const titleId = useId();

  const filtered = useMemo(
    () => filterLibraryEntries(CLINICAL_LIBRARY_ENTRIES, { query, category }),
    [query, category]
  );

  // Escape y clic fuera retroceden un paso: dentro de una herramienta vuelven a la lista
  // sin perder lo escrito; en la lista cierran el panel.
  const dismiss = useCallback(() => {
    if (activeToolId) {
      setActiveToolId(null);
      return;
    }
    onClose();
  }, [activeToolId, onClose]);

  const onDrawerKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key !== 'Tab' || !drawerRef.current) return;
    const focusable = drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    (activeToolId ? drawerRef.current : searchRef.current)?.focus();
  }, [activeToolId]);

  const activeTool = activeToolId ? TOOL_REGISTRY[activeToolId] : null;
  const chips: ReadonlyArray<{ id: LibraryCategoryFilter; label: string }> = [
    { id: 'all', label: 'Todo' },
    ...LIBRARY_CATEGORIES.map(item => ({ id: item.id, label: item.label })),
  ];

  return createPortal(
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        data-testid="clinical-library-overlay"
        style={{ zIndex: LAYER_Z_INDEX.drawerBackdrop }}
        className="fixed inset-0 cursor-default bg-slate-900/30"
        onClick={dismiss}
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="clinical-library-drawer"
        data-module="clinical-library"
        style={{ zIndex: LAYER_Z_INDEX.drawer }}
        onKeyDown={onDrawerKeyDown}
        className="fixed right-0 top-0 flex h-full w-[500px] max-w-full flex-col border-l border-slate-200 bg-slate-50 shadow-xl focus:outline-none"
      >
        <h2 id={titleId} className="sr-only">
          Documentos y herramientas
        </h2>
        {!activeTool && (
          <header className="shrink-0 border-b border-slate-200 bg-white px-4 pb-3 pt-3">
            <div className="flex items-center gap-2">
              <FolderOpen size={18} className="shrink-0 text-medical-700" aria-hidden="true" />
              <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-slate-800">
                Documentos
              </p>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar documentos"
                title="Cerrar (Esc)"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="relative mt-3">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Buscar"
                aria-label="Buscar en documentos y herramientas"
                autoComplete="off"
                className="h-9 w-full appearance-none rounded-full border border-slate-200 bg-white pl-8 pr-8 text-[13px] text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-medical-500 focus:outline-none focus:ring-2 focus:ring-medical-200 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                  aria-label="Limpiar búsqueda"
                  className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-0.5" role="group" aria-label="Categorías">
              {chips.map(chip => (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={category === chip.id}
                  onClick={() => setCategory(chip.id)}
                  className={clsx(
                    'rounded-full px-3 py-1 text-[12px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600',
                    category === chip.id
                      ? 'bg-slate-100 text-slate-900'
                      : 'text-slate-500 hover:text-slate-800'
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </header>
        )}

        <div
          data-testid="clinical-library-content"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
        >
          {activeTool ? (
            <activeTool.Component onBack={() => setActiveToolId(null)} onClose={onClose} />
          ) : (
            <LibraryEntryList
              entries={filtered}
              category={category}
              query={query}
              onOpenTool={setActiveToolId}
              onPrintDocument={documentActions.print}
            />
          )}
        </div>
      </aside>
    </>,
    document.body
  );
};
