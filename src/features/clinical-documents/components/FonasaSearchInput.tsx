/**
 * FonasaSearchInput
 *
 * Inline searchable input for FONASA billing codes (Anexo 9/14).
 * Supports three modes:
 *  - **Catalog**: search the FONASA database with abbreviation expansion
 *  - **Catalog + AI**: on-demand AI search via local Gemini/OpenAI/Anthropic
 *  - **Manual**: free-text input without code selection
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, PencilLine, Search, Sparkles, X } from 'lucide-react';

import type { FonasaEntry, FonasaCatalog } from '@/services/terminology/fonasaService';
import {
  searchFonasa,
  searchFonasaAI,
  isFonasaAIAvailable,
} from '@/services/terminology/fonasaService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Delay (ms) before triggering FONASA catalog search after typing stops. */
const FONASA_SEARCH_DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input mode for FONASA code fields. */
type FonasaInputMode = 'catalog' | 'manual';

/** Props for {@link FonasaSearchInput}. */
export interface FonasaSearchInputProps {
  /** Which FONASA catalog to search. */
  catalog: FonasaCatalog;
  /** Currently selected FONASA code (empty when nothing selected). */
  code: string;
  /** Description of the selected entry or manual text. */
  description: string;
  /** Called when user selects an entry from the catalog/AI results. */
  onSelect: (entry: FonasaEntry) => void;
  /** Called when user types free-text manually (no code). */
  onManualChange: (description: string) => void;
  /** Called to clear the current selection. */
  onClear: () => void;
  /** Placeholder text for the search input. */
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Inline FONASA search with catalog/manual mode toggle. */
export const FonasaSearchInput: React.FC<FonasaSearchInputProps> = ({
  catalog,
  code,
  description,
  onSelect,
  onManualChange,
  onClear,
  placeholder = 'Buscar por nombre, abreviatura o código FONASA...',
}) => {
  const [mode, setMode] = useState<FonasaInputMode>('catalog');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FonasaEntry[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [aiSearching, setAiSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenerationRef = useRef(0);
  const aiRequestGenerationRef = useRef<number | null>(null);
  const preferredAiGenerationRef = useRef<number | null>(null);
  const manualClearCatalogRef = useRef<FonasaCatalog | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const aiAvailable = isFonasaAIAvailable();

  const discardPendingSearch = useCallback(() => {
    searchGenerationRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const resetSearchActivity = useCallback(() => {
    discardPendingSearch();
    setSearching(false);
  }, [discardPendingSearch]);

  // A response belongs to the current query, catalog and controlled selection.
  useEffect(() => {
    resetSearchActivity();
    setResults(previous => (previous.length ? [] : previous));
    setShowDropdown(false);
    const preserveManualChoice = manualClearCatalogRef.current === catalog;
    manualClearCatalogRef.current = null;
    if (!code && !description) {
      if (!preserveManualChoice) setMode('catalog');
      setQuery('');
    }
  }, [code, description, catalog, resetSearchActivity]);

  useEffect(
    () => () => {
      discardPendingSearch();
      aiRequestGenerationRef.current = null;
    },
    [discardPendingSearch]
  );

  // Close dropdown when clicking outside the component
  useEffect(() => {
    if (!showDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  /** Debounced catalog search using abbreviation expansion. */
  const handleCatalogSearch = useCallback(
    (value: string) => {
      resetSearchActivity();
      const generation = searchGenerationRef.current;
      setQuery(value);
      setResults(previous => (previous.length ? [] : previous));
      if (value.length < 2) {
        setResults([]);
        setShowDropdown(false);
        return;
      }
      setShowDropdown(true);
      timerRef.current = setTimeout(async () => {
        timerRef.current = null;
        setSearching(true);
        try {
          const res = await searchFonasa(catalog, value);
          if (
            generation === searchGenerationRef.current &&
            preferredAiGenerationRef.current !== generation
          )
            setResults(res);
        } catch {
          if (
            generation === searchGenerationRef.current &&
            preferredAiGenerationRef.current !== generation
          )
            setResults([]);
        } finally {
          if (generation === searchGenerationRef.current) setSearching(false);
        }
      }, FONASA_SEARCH_DEBOUNCE_MS);
    },
    [catalog, resetSearchActivity]
  );

  /** On-demand AI search using the shared AI provider. */
  const handleAiSearch = useCallback(async () => {
    if (query.length < 2 || aiRequestGenerationRef.current !== null) return;
    const generation = searchGenerationRef.current;
    aiRequestGenerationRef.current = generation;
    setAiSearching(true);
    try {
      const aiResults = await searchFonasaAI(catalog, query);
      if (generation === searchGenerationRef.current && aiResults.length > 0) {
        preferredAiGenerationRef.current = generation;
        setResults(aiResults);
        setShowDropdown(true);
      }
    } catch {
      // AI unavailable — keep existing results
    } finally {
      if (aiRequestGenerationRef.current === generation) {
        aiRequestGenerationRef.current = null;
        setAiSearching(false);
      }
    }
  }, [query, catalog]);

  /** Switch between catalog and manual input modes. */
  const handleSwitchMode = useCallback(
    (newMode: FonasaInputMode) => {
      resetSearchActivity();
      setMode(newMode);
      if (newMode === 'manual') {
        // The parent echoes this clear; it must not undo the explicit mode choice.
        manualClearCatalogRef.current = code || description ? catalog : null;
        onClear();
        setQuery('');
        setResults([]);
        setShowDropdown(false);
      }
    },
    [onClear, code, description, catalog, resetSearchActivity]
  );

  // --- Selected code display (catalog mode) ---
  if (code && mode === 'catalog') {
    return (
      <div>
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-2 py-1.5">
          <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-mono font-bold text-emerald-700">
            {code}
          </span>
          <span className="flex-1 text-xs text-slate-700 truncate">{description}</span>
          <button
            type="button"
            onClick={onClear}
            className="p-0.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"
            aria-label="Cambiar selección"
            title="Cambiar"
          >
            <X size={12} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => handleSwitchMode('manual')}
          className="mt-1 text-[9px] text-slate-400 hover:text-slate-600 transition-colors"
        >
          Cambiar a texto libre
        </button>
      </div>
    );
  }

  // --- Manual free-text mode ---
  if (mode === 'manual') {
    return (
      <div>
        <input
          type="text"
          value={description}
          onChange={e => onManualChange(e.target.value)}
          placeholder="Descripción libre de la intervención/procedimiento"
          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
        />
        <button
          type="button"
          onClick={() => handleSwitchMode('catalog')}
          className="mt-1 text-[9px] text-slate-400 hover:text-slate-600 transition-colors"
        >
          Buscar en catálogo FONASA
        </button>
      </div>
    );
  }

  // --- Catalog search mode ---
  return (
    <div ref={containerRef}>
      <div className="relative">
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={e => handleCatalogSearch(e.target.value)}
              onFocus={() => results.length > 0 && setShowDropdown(true)}
              placeholder={placeholder}
              className="w-full rounded-md border border-slate-200 py-1.5 pl-7 pr-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
            />
            {searching && (
              <Loader2
                size={13}
                className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
              />
            )}
          </div>
          {aiAvailable && (
            <button
              type="button"
              onClick={handleAiSearch}
              disabled={query.length < 2 || aiSearching}
              className="flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-40 transition-colors"
              aria-label="Buscar con inteligencia artificial"
              title="Buscar con IA (conceptos, sinónimos)"
            >
              {aiSearching ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              IA
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSwitchMode('manual')}
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
            title="Escribir texto libre"
          >
            <PencilLine size={12} />
            Texto libre
          </button>
        </div>
        {showDropdown && results.length > 0 && (
          <div className="absolute z-30 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
            {results.map(entry => (
              <button
                key={entry.code}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  resetSearchActivity();
                  onSelect(entry);
                  setQuery('');
                  setShowDropdown(false);
                  setResults([]);
                }}
                className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-emerald-50 transition-colors"
              >
                <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-mono font-bold text-slate-600">
                  {entry.code}
                </span>
                <span className="text-xs text-slate-700 leading-snug">
                  {entry.description}
                  {entry.fromAI && (
                    <span
                      className="ml-1 text-violet-500 text-[9px]"
                      aria-label="Resultado generado por IA"
                    >
                      ⚡ IA
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
