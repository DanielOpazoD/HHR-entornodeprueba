/**
 * Global Patient Search — Shared contracts and types.
 *
 * Centralizes all type definitions used across the global search feature
 * to avoid inline anonymous types and ensure consistency.
 */

import type { MasterPatient, HospitalizationEvent } from '@/types/domain/patientMaster';
import type { PatientHistoryResult } from '@/services/patient/patientHistoryService';

// ---------------------------------------------------------------------------
// Clinical document summary (lightweight projection for search results)
// ---------------------------------------------------------------------------

export interface ClinicalDocSummary {
  id: string;
  episodeKey: string;
  documentType: string;
  status: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Episode document loading state
// ---------------------------------------------------------------------------

export interface EpisodeDocuments {
  episodeKey: string;
  docs: ClinicalDocSummary[];
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Selected patient detail (after clicking a search result)
// ---------------------------------------------------------------------------

export interface SelectedPatientDetail {
  master: MasterPatient;
  history: PatientHistoryResult | null;
  isLoadingHistory: boolean;
  timelineState: PatientEpisodeTimelineState;
}

// ---------------------------------------------------------------------------
// Grouped episode (admission paired with its discharge/transfer)
// ---------------------------------------------------------------------------

export interface GroupedEpisode {
  id: string;
  admission: HospitalizationEvent;
  discharge: HospitalizationEvent | null;
  diagnosis: string;
  bedName: string;
  daysOfStay: number | null;
}

export interface PatientEpisodeTimelineState {
  groupedEpisodes: GroupedEpisode[];
  episodeCount: number;
  hasEpisodes: boolean;
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

export interface UseGlobalPatientSearchReturn {
  /** Current search query string */
  query: string;
  /** Update search query (triggers debounced search) */
  setQuery: (q: string) => void;
  /** Search results from PatientMasterRepository */
  results: MasterPatient[];
  /** Whether a search request is in flight */
  isSearching: boolean;
  /** Whether at least one search has completed */
  hasSearched: boolean;
  /** Currently selected patient with loaded history */
  selectedPatient: SelectedPatientDetail | null;
  /** Select a patient to load episode detail */
  selectPatient: (patient: MasterPatient) => void;
  /** Clear selection and return to results list */
  clearSelection: () => void;
  /** Clinical documents loaded per episode key */
  episodeDocuments: Record<string, EpisodeDocuments>;
  /** Load clinical documents for a given episode key */
  loadEpisodeDocuments: (episodeKey: string) => void;
  /** Download a clinical document as PDF by its Firestore ID */
  downloadDocumentPdf: (docId: string, docType: string) => Promise<void>;
  /** Index of the currently highlighted result for keyboard nav */
  selectedIndex: number;
  /** Set the highlighted result index */
  setSelectedIndex: (index: number) => void;
  /** Reset all search state */
  reset: () => void;
}
