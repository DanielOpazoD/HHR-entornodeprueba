/**
 * usePatientSelection
 *
 * Handles selecting a patient from search results and loading
 * their movement history and clinical episode documents.
 */

import { useState, useCallback, useRef } from 'react';
import type { MasterPatient } from '@/types/domain/patientMaster';
import type { PatientHistoryResult } from '@/services/patient/patientHistoryService';
import type {
  SelectedPatientDetail,
  EpisodeDocuments,
  ClinicalDocSummary,
} from '@/features/census/components/global-search/globalSearchContracts';
import { buildPatientEpisodeTimelineState } from '@/features/census/components/global-search/patientEpisodeTimelineController';
import {
  buildPatientSelectionDocumentLookupKeys,
  parsePatientSelectionEpisodeLookupKey,
  summarizeClinicalDocuments,
} from '@/features/census/components/global-search/patientSelectionDocumentController';
import { globalPatientSearchLogger } from '@/hooks/hookLoggers';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

// ---------------------------------------------------------------------------
// Lazy loaders
// ---------------------------------------------------------------------------

let patientHistoryPromise: Promise<
  typeof import('@/services/patient/patientHistoryService')
> | null = null;
let clinicalDocRepoPromise: Promise<
  typeof import('@/services/repositories/ClinicalDocumentRepository')
> | null = null;
let clinicalDocPdfPromise: Promise<typeof import('@/features/clinical-documents')> | null = null;

const loadPatientHistory = () => {
  patientHistoryPromise ??= import('@/services/patient/patientHistoryService');
  return patientHistoryPromise;
};
const loadClinicalDocRepo = () => {
  clinicalDocRepoPromise ??= import('@/services/repositories/ClinicalDocumentRepository');
  return clinicalDocRepoPromise;
};
const loadClinicalDocPdf = () => {
  clinicalDocPdfPromise ??= import('@/features/clinical-documents');
  return clinicalDocPdfPromise;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildPatientHistoryCacheKey = (patient: MasterPatient): string =>
  `${patient.rut}::${patient.updatedAt ?? 0}`;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UsePatientSelectionReturn {
  selectedPatient: SelectedPatientDetail | null;
  selectPatient: (patient: MasterPatient) => void;
  clearSelection: () => void;
  episodeDocuments: Record<string, EpisodeDocuments>;
  loadEpisodeDocuments: (episodeKey: string) => void;
  downloadDocumentPdf: (docId: string, docType: string) => Promise<void>;
  resetSelection: () => void;
}

export function usePatientSelection(): UsePatientSelectionReturn {
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatientDetail | null>(null);
  const [episodeDocuments, setEpisodeDocuments] = useState<Record<string, EpisodeDocuments>>({});
  const historyCacheRef = useRef(new Map<string, PatientHistoryResult | null>());
  const historyRequestRef = useRef(new Map<string, Promise<PatientHistoryResult | null>>());

  const selectPatient = useCallback(async (patient: MasterPatient) => {
    const cacheKey = buildPatientHistoryCacheKey(patient);
    const cachedHistory = historyCacheRef.current.get(cacheKey);
    if (historyCacheRef.current.has(cacheKey)) {
      setSelectedPatient({
        master: patient,
        history: cachedHistory ?? null,
        isLoadingHistory: false,
        timelineState: buildPatientEpisodeTimelineState(patient, cachedHistory ?? null),
      });
      return;
    }

    setSelectedPatient({
      master: patient,
      history: null,
      isLoadingHistory: true,
      timelineState: buildPatientEpisodeTimelineState(patient, null),
    });

    try {
      let historyRequest = historyRequestRef.current.get(cacheKey);
      if (!historyRequest) {
        historyRequest = loadPatientHistory()
          .then(historyModule =>
            historyModule.getPatientMovementHistory(patient.rut, {
              forceFullRemoteHydration: true,
              hospitalizationHints: patient.hospitalizations ?? [],
              lastAdmission: patient.lastAdmission,
              lastDischarge: patient.lastDischarge,
            })
          )
          .finally(() => {
            historyRequestRef.current.delete(cacheKey);
          });
        historyRequestRef.current.set(cacheKey, historyRequest);
      }

      const history = await historyRequest;
      historyCacheRef.current.set(cacheKey, history);
      setSelectedPatient(prev =>
        prev && prev.master.rut === patient.rut
          ? {
              ...prev,
              history,
              isLoadingHistory: false,
              timelineState: buildPatientEpisodeTimelineState(patient, history),
            }
          : prev
      );
    } catch (err) {
      globalPatientSearchLogger.warn(`Failed to load history for ${patient.rut}`, err);
      setSelectedPatient(prev =>
        prev && prev.master.rut === patient.rut
          ? {
              ...prev,
              isLoadingHistory: false,
              timelineState: buildPatientEpisodeTimelineState(patient, null),
            }
          : prev
      );
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPatient(null);
    setEpisodeDocuments({});
  }, []);

  const loadEpisodeDocuments = useCallback(async (compositeKey: string) => {
    const parsed = parsePatientSelectionEpisodeLookupKey(compositeKey);
    if (!parsed) {
      globalPatientSearchLogger.warn(`Malformed episode key: ${compositeKey}`);
      return;
    }

    // Prevent concurrent loading for the same key
    setEpisodeDocuments(prev => {
      if (prev[compositeKey]?.isLoading || prev[compositeKey]?.docs.length) return prev;
      return { ...prev, [compositeKey]: { episodeKey: compositeKey, docs: [], isLoading: true } };
    });

    try {
      const docMod = await loadClinicalDocRepo();
      const candidateKeys = buildPatientSelectionDocumentLookupKeys(parsed);

      let foundDocs: ClinicalDocSummary[] = [];
      for (const candidateKey of candidateKeys) {
        const docs = await docMod.ClinicalDocumentRepository.listByEpisode(candidateKey);
        if (docs.length > 0) {
          foundDocs = summarizeClinicalDocuments(docs, candidateKey);
          break;
        }
      }

      setEpisodeDocuments(prev => ({
        ...prev,
        [compositeKey]: { episodeKey: compositeKey, docs: foundDocs, isLoading: false },
      }));
    } catch (err) {
      globalPatientSearchLogger.warn(`Failed to load documents for ${compositeKey}`, err);
      setEpisodeDocuments(prev => ({
        ...prev,
        [compositeKey]: { episodeKey: compositeKey, docs: [], isLoading: false },
      }));
    }
  }, []);

  /** Generate a clinical document PDF and open it in a new browser tab for preview. */
  const downloadDocumentPdf = useCallback(async (docId: string, _docType: string) => {
    try {
      const [docMod, pdfMod] = await Promise.all([loadClinicalDocRepo(), loadClinicalDocPdf()]);

      const record = await docMod.ClinicalDocumentRepository.get(docId);
      if (!record) {
        globalPatientSearchLogger.warn(`Document not found for PDF preview: ${docId}`);
        return;
      }

      const blob = await pdfMod.generateClinicalDocumentPdfBlob(record);
      const url = URL.createObjectURL(blob);
      defaultBrowserWindowRuntime.open(url, '_blank');
    } catch (err) {
      globalPatientSearchLogger.error(`PDF preview failed for document ${docId}`, err);
      throw err;
    }
  }, []);

  const resetSelection = useCallback(() => {
    setSelectedPatient(null);
    setEpisodeDocuments({});
    historyCacheRef.current.clear();
    historyRequestRef.current.clear();
  }, []);

  return {
    selectedPatient,
    selectPatient,
    clearSelection,
    episodeDocuments,
    loadEpisodeDocuments,
    downloadDocumentPdf,
    resetSelection,
  };
}
