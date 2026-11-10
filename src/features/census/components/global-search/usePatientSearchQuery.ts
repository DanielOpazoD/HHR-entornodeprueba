/**
 * usePatientSearchQuery
 *
 * Handles the debounced search query against the census application layer.
 * Single responsibility: input → debounce → search → results.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { searchMasterPatients } from '@/application/census/searchMasterPatientsUseCase';
import type { MasterPatient } from '@/types/domain/patientMaster';
import { globalPatientSearchLogger } from '@/hooks/hookLoggers';

const DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 20;

export interface UsePatientSearchQueryReturn {
  query: string;
  setQuery: (q: string) => void;
  results: MasterPatient[];
  isSearching: boolean;
  hasSearched: boolean;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  resetSearch: () => void;
}

export function usePatientSearchQuery(): UsePatientSearchQueryReturn {
  const [query, setQueryRaw] = useState('');
  const [results, setResults] = useState<MasterPatient[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchIdRef = useRef(0);

  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    setSelectedIndex(0);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Every change of the query retires the search already on its way, also a change that starts none.
    const currentId = ++searchIdRef.current;

    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    debounceRef.current = setTimeout(async () => {
      try {
        const outcome = await searchMasterPatients(trimmed, SEARCH_LIMIT);
        if (currentId !== searchIdRef.current) return;
        if (outcome.status === 'success') {
          setResults(outcome.data);
          return;
        }

        globalPatientSearchLogger.warn('Patient search failed', outcome);
        setResults([]);
      } catch (err) {
        globalPatientSearchLogger.warn('Patient search failed', err);
        if (currentId === searchIdRef.current) setResults([]);
      } finally {
        if (currentId === searchIdRef.current) {
          setIsSearching(false);
          setHasSearched(true);
        }
      }
    }, DEBOUNCE_MS);
  }, []);

  const resetSearch = useCallback(() => {
    setQueryRaw('');
    setResults([]);
    setIsSearching(false);
    setHasSearched(false);
    setSelectedIndex(0);
    searchIdRef.current++;
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    query,
    setQuery,
    results,
    isSearching,
    hasSearched,
    selectedIndex,
    setSelectedIndex,
    resetSearch,
  };
}
