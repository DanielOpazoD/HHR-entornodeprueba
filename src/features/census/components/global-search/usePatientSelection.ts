/**
 * usePatientSelection
 *
 * Handles selecting a patient from search results and loading
 * their movement history and clinical episode documents.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { MasterPatient } from '@/types/domain/patientMaster';
import type {
  PatientHistoryResult,
  PatientHistoryReadResult,
} from '@/services/patient/patientHistoryService';
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
  const historyRequestRef = useRef(
    new Map<
      string,
      {
        promise: Promise<PatientHistoryReadResult>;
        controller: AbortController;
      }
    >()
  );
  const selectionRevisionRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);

  const cancelHistory = useCallback(() => {
    selectionRevisionRef.current++;
    for (const request of historyRequestRef.current.values()) request.controller.abort();
    historyRequestRef.current.clear();
    activeControllerRef.current = null;
  }, []);
  useEffect(() => cancelHistory, [cancelHistory]);

  const selectPatient = useCallback(async (patient: MasterPatient) => {
    const cacheKey = buildPatientHistoryCacheKey(patient);
    const selectionRevision = ++selectionRevisionRef.current;
    for (const [key, request] of historyRequestRef.current) {
      if (key !== cacheKey) {
        request.controller.abort();
        historyRequestRef.current.delete(key);
      }
    }
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

    setSelectedPatient(prev => ({
      master: patient,
      history: null,
      isLoadingHistory: true,
      historyRecordsRead:
        prev && buildPatientHistoryCacheKey(prev.master) === cacheKey ? prev.historyRecordsRead : 0,
      timelineState: buildPatientEpisodeTimelineState(patient, null),
    }));

    try {
      let historyRequest = historyRequestRef.current.get(cacheKey);
      if (!historyRequest) {
        const controller = new AbortController();
        const promise = loadPatientHistory()
          .then(historyModule =>
            historyModule.getPatientMovementHistoryDetailed(patient.rut, {
              forceFullRemoteHydration: true,
              hospitalizationHints: patient.hospitalizations ?? [],
              lastAdmission: patient.lastAdmission,
              lastDischarge: patient.lastDischarge,
              signal: controller.signal,
              onProgress: recordsRead => {
                if (controller.signal.aborted || activeControllerRef.current !== controller) return;
                setSelectedPatient(prev =>
                  prev && buildPatientHistoryCacheKey(prev.master) === cacheKey
                    ? { ...prev, historyRecordsRead: recordsRead }
                    : prev
                );
              },
            })
          )
          .finally(() => {
            if (historyRequestRef.current.get(cacheKey)?.controller === controller) {
              historyRequestRef.current.delete(cacheKey);
            }
          });
        historyRequest = { promise, controller };
        historyRequestRef.current.set(cacheKey, historyRequest);
      }
      activeControllerRef.current = historyRequest.controller;

      const { history, source } = await historyRequest.promise;
      if (
        historyRequest.controller.signal.aborted ||
        selectionRevisionRef.current !== selectionRevision
      )
        return;
      if (source === 'server') historyCacheRef.current.set(cacheKey, history);
      setSelectedPatient(prev =>
        prev && prev.master.rut === patient.rut
          ? {
              ...prev,
              history,
              historyWarning:
                source === 'local'
                  ? 'Historial parcial: no se pudo consultar el servidor. Se muestran los datos disponibles localmente.'
                  : null,
              isLoadingHistory: false,
              timelineState: buildPatientEpisodeTimelineState(patient, history),
            }
          : prev
      );
    } catch (err) {
      if (selectionRevisionRef.current !== selectionRevision) return;
      globalPatientSearchLogger.warn(`Failed to load history for ${patient.rut}`, err);
      setSelectedPatient(prev =>
        prev && prev.master.rut === patient.rut
          ? {
              ...prev,
              isLoadingHistory: false,
              historyWarning: 'No se pudo cargar el historial. Puedes reintentar la consulta.',
              timelineState: buildPatientEpisodeTimelineState(patient, null),
            }
          : prev
      );
    }
  }, []);

  const clearSelection = useCallback(() => {
    cancelHistory();
    setSelectedPatient(null);
    setEpisodeDocuments({});
  }, [cancelHistory]);

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
    cancelHistory();
    setSelectedPatient(null);
    setEpisodeDocuments({});
    historyCacheRef.current.clear();
    historyRequestRef.current.clear();
  }, [cancelHistory]);

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
