/**
 * ClinicalLibraryDrawer — panel lateral «Documentos y herramientas» del censo.
 *
 * Catálogo estático (sin Firestore ni datos de pacientes): formularios para
 * imprimir, protocolos e infografías del servicio, y herramientas clínicas que
 * funcionan sin conexión. Se monta por portal, cierra con Esc o clic fuera y
 * devuelve el foco al botón que lo abrió (lo gestiona el quick action).
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { FolderOpen, Search, X } from 'lucide-react';
import { CLINICAL_LIBRARY_ENTRIES, LIBRARY_CATEGORIES } from '../domain/libraryCatalog';
import type { LibraryDocumentEntry, LibraryToolId } from '../domain/libraryCatalogTypes';
import {
  countLibraryEntriesByCategory,
  filterLibraryEntries,
  type LibraryCategoryFilter,
} from '../domain/librarySearch';
import { openLibraryDocument, printLibraryDocument } from '../services/libraryDocumentActions';
import { LibraryEntryList } from './LibraryEntryList';
import { DosingCalculatorTool } from './tools/DosingCalculatorTool';
import { InfusionCalculatorTool } from './tools/InfusionCalculatorTool';
import { ScoresTool } from './tools/ScoresTool';

export interface LibraryDocumentActions {
  open: (entry: LibraryDocumentEntry) => void;
  print: (entry: LibraryDocumentEntry) => void;
}

const DEFAULT_DOCUMENT_ACTIONS: LibraryDocumentActions = {
  open: entry => openLibraryDocument(entry.url),
  print: entry => {
    printLibraryDocument(entry.url);
  },
};

const TOOL_COMPONENTS: Readonly<
  Record<LibraryToolId, React.ComponentType<{ onBack: () => void }>>
> = {
  infusion: InfusionCalculatorTool,
  dosing: DosingCalculatorTool,
  scores: ScoresTool,
};

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

  const counts = useMemo(() => countLibraryEntriesByCategory(CLINICAL_LIBRARY_ENTRIES), []);
  const filtered = useMemo(
    () => filterLibraryEntries(CLINICAL_LIBRARY_ENTRIES, { query, category }),
    [query, category]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Al abrir, el foco cae en la búsqueda; al entrar a una herramienta, en el panel.
  useEffect(() => {
    (activeToolId ? drawerRef.current : searchRef.current)?.focus();
  }, [activeToolId]);

  const ActiveTool = activeToolId ? TOOL_COMPONENTS[activeToolId] : null;
  const chips: ReadonlyArray<{ id: LibraryCategoryFilter; label: string; count: number }> = [
    { id: 'all', label: 'Todo', count: CLINICAL_LIBRARY_ENTRIES.length },
    ...LIBRARY_CATEGORIES.map(item => ({ id: item.id, label: item.label, count: counts[item.id] })),
  ];

  return createPortal(
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        data-testid="clinical-library-overlay"
        className="fixed inset-0 z-[1100] cursor-default bg-slate-900/30"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="clinical-library-drawer"
        data-module="clinical-library"
        className="fixed right-0 top-0 z-[1101] flex h-full w-[500px] max-w-full flex-col border-l border-slate-200 bg-slate-50 shadow-xl focus:outline-none"
      >
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 pb-3 pt-3">
          <div className="flex items-start gap-2.5">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm">
              <FolderOpen size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[15px] font-bold leading-tight text-slate-800">
                Documentos y herramientas
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Formularios, protocolos, infografías y calculadoras del Servicio de Hospitalizados.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar documentos"
              title="Cerrar (Esc)"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          {!ActiveTool && (
            <>
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
                  placeholder="Buscar formulario, protocolo, fármaco o score…"
                  aria-label="Buscar en documentos y herramientas"
                  autoComplete="off"
                  className="h-9 w-full appearance-none rounded-md border border-slate-300 bg-white pl-8 pr-8 text-[13px] text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200 [&::-webkit-search-cancel-button]:hidden"
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
              <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Categorías">
                {chips.map(chip => (
                  <button
                    key={chip.id}
                    type="button"
                    aria-pressed={category === chip.id}
                    onClick={() => setCategory(chip.id)}
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600',
                      category === chip.id
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700'
                    )}
                  >
                    {chip.label}
                    <span
                      className={clsx(
                        'tabular-nums',
                        category === chip.id ? 'text-teal-100' : 'text-slate-400'
                      )}
                    >
                      {chip.count}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </header>

        <div
          data-testid="clinical-library-content"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
        >
          {ActiveTool ? (
            <ActiveTool onBack={() => setActiveToolId(null)} />
          ) : (
            <LibraryEntryList
              entries={filtered}
              category={category}
              query={query}
              onOpenTool={setActiveToolId}
              onOpenDocument={documentActions.open}
              onPrintDocument={documentActions.print}
            />
          )}
        </div>

        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-2 text-[10px] leading-snug text-slate-400">
          Uso interno · Hospital Hanga Roa · Las herramientas son apoyo a la decisión clínica y no
          reemplazan el juicio profesional.
        </footer>
      </aside>
    </>,
    document.body
  );
};
