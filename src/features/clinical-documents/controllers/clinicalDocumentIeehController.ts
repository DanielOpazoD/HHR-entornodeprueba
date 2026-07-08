/**
 * clinicalDocumentIeehController
 *
 * Pure logic for building and managing the IEEH (Informe Estadístico
 * de Egreso Hospitalario) draft within an epicrisis document.
 *
 * The draft captures structured discharge data (CIE-10, condition,
 * surgery, procedure) while the doctor writes the epicrisis.
 * Discharge time is intentionally omitted — the nurse fills it
 * when physically discharging the patient from the census.
 */

import type { ClinicalDocumentIeehDraft } from '@/features/clinical-documents/domain/entities';

// ---------------------------------------------------------------------------
// Discharge condition options (MINSAL codes 1-7)
// ---------------------------------------------------------------------------

export const IEEH_DISCHARGE_CONDITIONS = [
  { value: '1', label: 'Domicilio' },
  { value: '2', label: 'Derivación a otro establecimiento de la red pública' },
  { value: '3', label: 'Derivación a institución privada' },
  { value: '4', label: 'Derivación a otros centros u otra institución' },
  { value: '5', label: 'Alta voluntaria' },
  { value: '6', label: 'Fuga del paciente' },
  { value: '7', label: 'Hospitalización domiciliaria' },
] as const;

// ---------------------------------------------------------------------------
// Draft factory
// ---------------------------------------------------------------------------

/** Creates a blank IEEH draft with sensible defaults. */
export const createEmptyIeehDraft = (): ClinicalDocumentIeehDraft => ({
  cie10Code: '',
  cie10Description: '',
  diagnosticoPrincipal: '',
  condicionEgreso: '1',
  intervencionQuirurgica: '2',
  procedimiento: '2',
  tratanteNombreCompleto: '',
  tratanteEspecialidad: '',
  tratanteRut: '',
});

/** Whether the draft has a CIE-10 code selected (minimum viable data). */
export const isIeehDraftFilled = (draft: ClinicalDocumentIeehDraft | undefined): boolean =>
  !!draft?.cie10Code;

export interface ClinicalDocumentIeehPanelState {
  hasSelectedDiagnosis: boolean;
  shouldShowDiagnosisResults: boolean;
  canRunAiSearch: boolean;
  shouldShowInterventionSelector: boolean;
  shouldShowProcedureSelector: boolean;
  canPrintIeeh: boolean;
  printButtonTitle: string;
}

export const resolveClinicalDocumentIeehPanelState = ({
  draft,
  searchQuery,
  searchResultsCount,
  showResults,
  isAiSearching,
  isPrinting,
}: {
  draft: ClinicalDocumentIeehDraft;
  searchQuery: string;
  searchResultsCount: number;
  showResults: boolean;
  isAiSearching: boolean;
  isPrinting: boolean;
}): ClinicalDocumentIeehPanelState => {
  const hasSelectedDiagnosis = isIeehDraftFilled(draft);
  const canPrintIeeh = !isPrinting;

  return {
    hasSelectedDiagnosis,
    shouldShowDiagnosisResults: showResults && searchResultsCount > 0,
    canRunAiSearch: searchQuery.length >= 2 && !isAiSearching,
    shouldShowInterventionSelector: draft.intervencionQuirurgica === '1',
    shouldShowProcedureSelector: draft.procedimiento === '1',
    canPrintIeeh,
    printButtonTitle: 'Imprimir IEEH',
  };
};
