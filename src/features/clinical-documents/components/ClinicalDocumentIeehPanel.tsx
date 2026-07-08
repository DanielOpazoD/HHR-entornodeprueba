/**
 * ClinicalDocumentIeehPanel
 *
 * Collapsible panel rendered below the "Diagnósticos de egreso" section
 * in epicrisis documents. Allows the doctor to optionally fill the
 * statistical discharge (IEEH) while writing the epicrisis.
 *
 * Captures CIE-10 code, discharge condition, surgical intervention,
 * and procedure. Discharge time is left blank — the nurse fills it
 * when the patient physically leaves.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ClipboardList } from 'lucide-react';
import clsx from 'clsx';

import type {
  ClinicalDocumentIeehDraft,
  ClinicalDocumentRecord,
} from '@/features/clinical-documents/domain/entities';
import {
  createEmptyIeehDraft,
  resolveClinicalDocumentIeehPanelState,
} from '@/features/clinical-documents/controllers/clinicalDocumentIeehController';
import {
  buildIeehPatientFromEpicrisis,
  buildIeehDischargeFromEpicrisis,
} from '@/features/clinical-documents/controllers/clinicalDocumentIeehPrintController';
import type { TerminologyConcept } from '@/services/terminology/terminologyService';
import { searchDiagnoses, forceAISearch } from '@/services/terminology/terminologyService';
import { logger } from '@/services/utils/loggerService';
import { ClinicalDocumentIeehFormBody } from '@/features/clinical-documents/components/ClinicalDocumentIeehFormBody';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Delay before triggering CIE-10 search after typing stops. */
const SEARCH_DEBOUNCE_MS = 350;
const ieehPanelLogger = logger.child('ClinicalDocumentIeehPanel');

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Props for {@link ClinicalDocumentIeehPanel}. */
interface ClinicalDocumentIeehPanelProps {
  /** The parent epicrisis document (needed for patient data when printing). */
  document: ClinicalDocumentRecord;
  /** Workspace patient data (provides birthDate for IEEH PDF). */
  workspacePatient?: { birthDate?: string };
  /** Current saved draft (undefined when panel not yet opened). */
  draft: ClinicalDocumentIeehDraft | undefined;
  /** Whether the user can modify the draft. */
  canEdit: boolean;
  /** Callback to persist changes to the draft. */
  onPatchDraft: (draft: ClinicalDocumentIeehDraft) => void;
  /** Callback to remove the entire draft from the document. */
  onClearDraft: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/** Collapsible IEEH panel for epicrisis documents. */
export const ClinicalDocumentIeehPanel: React.FC<ClinicalDocumentIeehPanelProps> = ({
  document: epicrisisDoc,
  workspacePatient,
  draft,
  canEdit,
  onPatchDraft,
  onClearDraft,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [localDraft, setLocalDraft] = useState<ClinicalDocumentIeehDraft>(
    () => draft ?? createEmptyIeehDraft()
  );

  // CIE-10 search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TerminologyConcept[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cie10ContainerRef = useRef<HTMLDivElement>(null);

  // Sync from external draft when it changes (e.g. autosave round-trip or clear)
  useEffect(() => {
    setLocalDraft(draft ?? createEmptyIeehDraft());
  }, [draft]);

  // Cleanup timers and abort controllers on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // Close CIE-10 dropdown when clicking outside
  useEffect(() => {
    if (!showResults) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (cie10ContainerRef.current && !cie10ContainerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showResults]);

  /** Persist local changes to parent via reducer dispatch. */
  const commitDraft = useCallback(
    (next: ClinicalDocumentIeehDraft) => {
      setLocalDraft(next);
      onPatchDraft(next);
    },
    [onPatchDraft]
  );

  /** Debounced CIE-10 search using the terminology service. */
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    abortRef.current?.abort();

    if (query.length < 2) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setShowResults(true);
    searchTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsSearching(true);
      try {
        const results = await searchDiagnoses(query, controller.signal);
        if (!controller.signal.aborted) setSearchResults(results);
      } catch {
        // Network or abort error — reset to empty
        if (!controller.signal.aborted) setSearchResults([]);
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  /** Force AI-powered search via Gemini. */
  const handleAiSearch = useCallback(async () => {
    if (searchQuery.length < 2 || isAiSearching) return;
    setIsAiSearching(true);
    try {
      const results = await forceAISearch(searchQuery);
      setSearchResults(results);
      setShowResults(true);
    } catch {
      // AI search failed — keep existing results
    } finally {
      setIsAiSearching(false);
    }
  }, [searchQuery, isAiSearching]);

  /** Select a CIE-10 concept from search results. */
  const handleSelectDiagnosis = useCallback(
    (concept: TerminologyConcept) => {
      commitDraft({
        ...localDraft,
        cie10Code: concept.code,
        cie10Description: concept.display,
        diagnosticoPrincipal: concept.display,
      });
      setSearchQuery('');
      setShowResults(false);
      setSearchResults([]);
    },
    [localDraft, commitDraft]
  );

  /** Clear the selected CIE-10 code. */
  const handleClearDiagnosis = useCallback(() => {
    commitDraft({ ...localDraft, cie10Code: '', cie10Description: '', diagnosticoPrincipal: '' });
  }, [localDraft, commitDraft]);

  /** Type-safe generic field updater for the draft. */
  const patchField = useCallback(
    <K extends keyof ClinicalDocumentIeehDraft>(field: K, value: ClinicalDocumentIeehDraft[K]) => {
      commitDraft({ ...localDraft, [field]: value });
    },
    [localDraft, commitDraft]
  );

  const [isPrinting, setIsPrinting] = useState(false);
  const panelState = resolveClinicalDocumentIeehPanelState({
    draft: localDraft,
    searchQuery,
    searchResultsCount: searchResults.length,
    showResults,
    isAiSearching,
    isPrinting,
  });
  const {
    hasSelectedDiagnosis,
    shouldShowDiagnosisResults,
    canRunAiSearch,
    shouldShowInterventionSelector,
    shouldShowProcedureSelector,
    canPrintIeeh,
    printButtonTitle,
  } = panelState;

  /** Print the IEEH PDF using the official MINSAL template. */
  const handlePrintIeeh = useCallback(async () => {
    if (!canPrintIeeh) return;
    setIsPrinting(true);
    try {
      const { printIEEHForm } = await import('@/services/pdf/ieehPdfService');
      const currentIeehDocument = {
        ...epicrisisDoc,
        ieehDraft: localDraft,
      };
      const patient = buildIeehPatientFromEpicrisis(currentIeehDocument, workspacePatient);
      const discharge = buildIeehDischargeFromEpicrisis(currentIeehDocument);
      // IeehPatientSnapshot is a subset of PatientData — the PDF service
      // only reads the fields we provide; missing census-only fields
      // (bedId, isBlocked, etc.) are not used by fillIEEHForm.
      await printIEEHForm(patient as Parameters<typeof printIEEHForm>[0], discharge);
    } catch (error) {
      ieehPanelLogger.error('Failed to print IEEH form from epicrisis', error);
    } finally {
      setIsPrinting(false);
    }
  }, [canPrintIeeh, localDraft, epicrisisDoc, workspacePatient]);

  /** Remove the entire IEEH draft from the document. */
  const handleRemovePanel = useCallback(() => {
    onClearDraft();
    setLocalDraft(createEmptyIeehDraft());
    setIsOpen(false);
  }, [onClearDraft]);

  return (
    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/40 print:hidden">
      {/* Collapse header */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors"
      >
        <ClipboardList size={14} />
        Egreso Estadístico
        <span className="text-[10px] font-normal text-emerald-600">(opcional)</span>
        {hasSelectedDiagnosis && (
          <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
            {localDraft.cie10Code}
          </span>
        )}
        <ChevronDown
          size={14}
          className={clsx('ml-auto transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {/* Panel body */}
      {isOpen && canEdit && (
        <ClinicalDocumentIeehFormBody
          localDraft={localDraft}
          searchQuery={searchQuery}
          searchResults={searchResults}
          isSearching={isSearching}
          isAiSearching={isAiSearching}
          hasSelectedDiagnosis={hasSelectedDiagnosis}
          shouldShowDiagnosisResults={shouldShowDiagnosisResults}
          canRunAiSearch={canRunAiSearch}
          shouldShowInterventionSelector={shouldShowInterventionSelector}
          shouldShowProcedureSelector={shouldShowProcedureSelector}
          canPrintIeeh={canPrintIeeh}
          printButtonTitle={printButtonTitle}
          isPrinting={isPrinting}
          cie10ContainerRef={cie10ContainerRef}
          onSearchChange={handleSearchChange}
          onOpenSearchResults={() => searchResults.length > 0 && setShowResults(true)}
          onAiSearch={handleAiSearch}
          onSelectDiagnosis={handleSelectDiagnosis}
          onClearDiagnosis={handleClearDiagnosis}
          onPatchField={patchField}
          onCommitDraft={commitDraft}
          onPrintIeeh={handlePrintIeeh}
          onRemovePanel={handleRemovePanel}
        />
      )}
    </div>
  );
};
