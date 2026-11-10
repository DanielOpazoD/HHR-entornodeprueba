/**
 * useGlobalPatientSearch Hook
 *
 * Composes search query + patient selection into a unified interface
 * for the GlobalPatientSearchModal.
 *
 * Sub-hooks:
 * - usePatientSearchQuery: debounced search against PatientMasterRepository
 * - usePatientSelection: patient detail, episode documents, PDF download
 *
 * @returns {UseGlobalPatientSearchReturn} Search state and actions
 */

import { useCallback } from 'react';
import type { UseGlobalPatientSearchReturn } from '@/features/census/components/global-search/globalSearchContracts';
import { usePatientSearchQuery } from '@/features/census/components/global-search/usePatientSearchQuery';
import { usePatientSelection } from '@/features/census/components/global-search/usePatientSelection';

export function useGlobalPatientSearch(): UseGlobalPatientSearchReturn {
  const search = usePatientSearchQuery();
  const selection = usePatientSelection();

  const reset = useCallback(() => {
    search.resetSearch();
    selection.resetSelection();
  }, [search, selection]);

  return {
    // Search query
    query: search.query,
    setQuery: search.setQuery,
    results: search.results,
    isSearching: search.isSearching,
    hasSearched: search.hasSearched,
    searchError: search.searchError,
    retrySearch: search.retrySearch,
    selectedIndex: search.selectedIndex,
    setSelectedIndex: search.setSelectedIndex,

    // Patient selection & documents
    selectedPatient: selection.selectedPatient,
    selectPatient: selection.selectPatient,
    clearSelection: selection.clearSelection,
    episodeDocuments: selection.episodeDocuments,
    loadEpisodeDocuments: selection.loadEpisodeDocuments,
    downloadDocumentPdf: selection.downloadDocumentPdf,

    // Global
    reset,
  };
}
