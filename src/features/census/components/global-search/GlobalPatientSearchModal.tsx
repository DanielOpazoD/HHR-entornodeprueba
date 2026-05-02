/**
 * GlobalPatientSearchModal
 *
 * Command-palette style modal for searching patients globally
 * across all dates by name, last name, or RUT.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Loader2, Users } from 'lucide-react';
import { useGlobalPatientSearch } from '@/features/census/components/global-search/useGlobalPatientSearch';
import { PatientSearchResultItem } from '@/features/census/components/global-search/PatientSearchResultItem';
import { PatientEpisodeTimeline } from '@/features/census/components/global-search/PatientEpisodeTimeline';
import { SearchResultsSkeleton } from '@/features/census/components/global-search/SearchResultsSkeleton';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GlobalPatientSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToDate?: (isoDate: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GlobalPatientSearchModal: React.FC<GlobalPatientSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigateToDate,
}) => {
  const search = useGlobalPatientSearch();

  const handleNavigateToDate = useCallback(
    (isoDate: string) => {
      onClose();
      onNavigateToDate?.(isoDate);
    },
    [onClose, onNavigateToDate]
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const resetRef = useRef(search.reset);

  useEffect(() => {
    resetRef.current = search.reset;
  }, [search.reset]);

  // Focus input on open, reset state on close
  useEffect(() => {
    if (isOpen) {
      const raf = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
    resetRef.current();
  }, [isOpen]);

  // ---- Keyboard navigation ----
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (search.selectedPatient) {
          search.clearSelection();
        } else {
          onClose();
        }
        return;
      }

      // Only navigate results when no patient is selected
      if (search.selectedPatient) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        search.setSelectedIndex(Math.min(search.selectedIndex + 1, search.results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        search.setSelectedIndex(Math.max(search.selectedIndex - 1, 0));
      } else if (e.key === 'Enter' && search.results.length > 0) {
        e.preventDefault();
        const patient = search.results[search.selectedIndex];
        if (patient) search.selectPatient(patient);
      }
    },
    [search, onClose]
  );

  // ---- Backdrop click ----
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[2vh] px-4"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Buscar paciente"
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" />

      {/* Modal panel */}
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col max-h-[94vh]">
        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search.query}
            onChange={e => search.setQuery(e.target.value)}
            placeholder="Buscar por nombre, apellido o RUT..."
            className="flex-1 text-sm text-slate-800 placeholder-slate-400 outline-none bg-transparent"
            autoComplete="off"
            spellCheck={false}
          />
          {search.isSearching && (
            <Loader2 size={16} className="text-medical-500 animate-spin shrink-0" />
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            <kbd className="hidden sm:inline-flex items-center text-[10px] font-mono text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 border border-slate-200">
              ESC
            </kbd>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content area */}
        <div
          className={search.selectedPatient ? 'flex-1 overflow-hidden' : 'flex-1 overflow-y-auto'}
        >
          {/* Detail view when a patient is selected */}
          {search.selectedPatient && (
            <div className="p-3">
              <PatientEpisodeTimeline
                patient={search.selectedPatient.master}
                history={search.selectedPatient.history}
                isLoadingHistory={search.selectedPatient.isLoadingHistory}
                timelineState={search.selectedPatient.timelineState}
                episodeDocuments={search.episodeDocuments}
                onLoadDocuments={search.loadEpisodeDocuments}
                onDownloadPdf={search.downloadDocumentPdf}
                onNavigateToDate={onNavigateToDate ? handleNavigateToDate : undefined}
                onBack={search.clearSelection}
              />
            </div>
          )}

          {/* Results list */}
          {!search.selectedPatient && (
            <>
              {/* Empty state: initial */}
              {!search.hasSearched && !search.isSearching && search.query.length < 2 && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Users size={32} className="mb-2 text-slate-300" />
                  <p className="text-sm">Escribe para buscar en todo el historial</p>
                  <p className="text-[10px] mt-1 text-slate-300">
                    Busca por nombre, apellido o RUT del paciente
                  </p>
                </div>
              )}

              {/* Skeleton loading */}
              {search.isSearching && <SearchResultsSkeleton />}

              {/* No results */}
              {search.hasSearched && !search.isSearching && search.results.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Search size={28} className="mb-2 text-slate-300" />
                  <p className="text-sm">
                    No se encontraron pacientes para &ldquo;{search.query}&rdquo;
                  </p>
                  <p className="text-[10px] mt-1 text-slate-300">Intenta con otro nombre o RUT</p>
                </div>
              )}

              {/* Results */}
              {search.results.length > 0 && (
                <div className="py-1">
                  <div className="px-4 py-1.5">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      {search.results.length} resultado{search.results.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {search.results.map((patient, index) => (
                    <PatientSearchResultItem
                      key={patient.rut}
                      patient={patient}
                      isSelected={index === search.selectedIndex}
                      onClick={() => search.selectPatient(patient)}
                      searchQuery={search.query}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!search.selectedPatient && (
          <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 bg-slate-50/80 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-slate-100 rounded px-1 py-0.5 border border-slate-200 text-[9px]">
                &uarr;&darr;
              </kbd>
              navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-slate-100 rounded px-1 py-0.5 border border-slate-200 text-[9px]">
                Enter
              </kbd>
              seleccionar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-slate-100 rounded px-1 py-0.5 border border-slate-200 text-[9px]">
                ESC
              </kbd>
              cerrar
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
