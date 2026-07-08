/**
 * Tests for the IEEH controller (draft factory and validation).
 */

import { describe, expect, it } from 'vitest';
import {
  createEmptyIeehDraft,
  isIeehDraftFilled,
  IEEH_DISCHARGE_CONDITIONS,
  resolveClinicalDocumentIeehPanelState,
} from '@/features/clinical-documents/controllers/clinicalDocumentIeehController';

describe('createEmptyIeehDraft', () => {
  it('returns a draft with all required fields and sensible defaults', () => {
    const draft = createEmptyIeehDraft();

    expect(draft.cie10Code).toBe('');
    expect(draft.cie10Description).toBe('');
    expect(draft.diagnosticoPrincipal).toBe('');
    expect(draft.condicionEgreso).toBe('1'); // Domicilio
    expect(draft.intervencionQuirurgica).toBe('2'); // No
    expect(draft.procedimiento).toBe('2'); // No
    expect(draft.tratanteRut).toBe('');
  });
});

describe('isIeehDraftFilled', () => {
  it('returns false for undefined draft', () => {
    expect(isIeehDraftFilled(undefined)).toBe(false);
  });

  it('returns false when cie10Code is empty', () => {
    expect(isIeehDraftFilled(createEmptyIeehDraft())).toBe(false);
  });

  it('returns true when cie10Code is set', () => {
    const draft = { ...createEmptyIeehDraft(), cie10Code: 'E11.5' };
    expect(isIeehDraftFilled(draft)).toBe(true);
  });
});

describe('IEEH_DISCHARGE_CONDITIONS', () => {
  it('has 7 MINSAL discharge condition options', () => {
    expect(IEEH_DISCHARGE_CONDITIONS).toHaveLength(7);
  });

  it('values are sequential string codes from 1 to 7', () => {
    IEEH_DISCHARGE_CONDITIONS.forEach((opt, idx) => {
      expect(opt.value).toBe(String(idx + 1));
    });
  });

  it('first option is Domicilio', () => {
    expect(IEEH_DISCHARGE_CONDITIONS[0].label).toBe('Domicilio');
  });
});

describe('resolveClinicalDocumentIeehPanelState', () => {
  it('allows printing a blank IEEH while keeping diagnosis-driven display state empty', () => {
    expect(
      resolveClinicalDocumentIeehPanelState({
        draft: createEmptyIeehDraft(),
        searchQuery: 'neo',
        searchResultsCount: 2,
        showResults: true,
        isAiSearching: false,
        isPrinting: false,
      })
    ).toEqual({
      hasSelectedDiagnosis: false,
      shouldShowDiagnosisResults: true,
      canRunAiSearch: true,
      shouldShowInterventionSelector: false,
      shouldShowProcedureSelector: false,
      canPrintIeeh: true,
      printButtonTitle: 'Imprimir IEEH',
    });
  });

  it('reflects filled draft selectors and disables printing while busy', () => {
    expect(
      resolveClinicalDocumentIeehPanelState({
        draft: {
          ...createEmptyIeehDraft(),
          cie10Code: 'E11.5',
          intervencionQuirurgica: '1',
          procedimiento: '1',
        },
        searchQuery: 'n',
        searchResultsCount: 0,
        showResults: true,
        isAiSearching: true,
        isPrinting: true,
      })
    ).toEqual({
      hasSelectedDiagnosis: true,
      shouldShowDiagnosisResults: false,
      canRunAiSearch: false,
      shouldShowInterventionSelector: true,
      shouldShowProcedureSelector: true,
      canPrintIeeh: false,
      printButtonTitle: 'Imprimir IEEH',
    });
  });
});
