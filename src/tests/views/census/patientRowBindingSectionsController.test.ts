import { describe, expect, it, vi } from 'vitest';

import {
  buildPatientMainSectionBindings,
  buildPatientModalSectionBindings,
  buildPatientSubSectionBindings,
} from '@/features/census/controllers/patientRowBindingSectionsController';
import type { PatientRowRuntime } from '@/features/census/components/patient-row/patientRowRuntimeContracts';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType } from '@/types/domain/beds';

const asRuntime = (value: Partial<PatientRowRuntime>): PatientRowRuntime =>
  value as unknown as PatientRowRuntime;

describe('patientRowBindingSectionsController', () => {
  it('builds section bindings from runtime and resolved view context', () => {
    const bed = { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false };
    const data = DataFactory.createMockPatient('R1');
    const runtime = asRuntime({
      bedTypeToggles: {
        onToggleBedType: vi.fn(),
        onUpdateClinicalCrib: vi.fn(),
      },
      rowState: {
        isBlocked: false,
        isEmpty: false,
        hasCompanion: true,
        hasClinicalCrib: false,
        isCunaMode: false,
      },
      uiState: {
        showDemographics: true,
        showClinicalDocuments: true,
        showExamRequest: false,
        showImagingRequest: false,
        showHistory: true,
        openDemographics: vi.fn(),
        closeDemographics: vi.fn(),
        openClinicalDocuments: vi.fn(),
        closeClinicalDocuments: vi.fn(),
        openExamRequest: vi.fn(),
        closeExamRequest: vi.fn(),
        openImagingRequest: vi.fn(),
        closeImagingRequest: vi.fn(),
        openHistory: vi.fn(),
        closeHistory: vi.fn(),
      },
      handlers: {
        mainInputChangeHandlers:
          {} as unknown as PatientRowRuntime['handlers']['mainInputChangeHandlers'],
        cribInputChangeHandlers:
          {} as unknown as PatientRowRuntime['handlers']['cribInputChangeHandlers'],
      },
      modalSavers: {
        onSaveDemographics: vi.fn(),
        onSaveCribDemographics: vi.fn(),
        onRevertEmptyDemographics: vi.fn(),
      },
      bedConfigActions: {
        toggleBedMode: vi.fn(),
        toggleCompanionCrib: vi.fn(),
        toggleClinicalCrib: vi.fn(),
        removeClinicalCrib: vi.fn(),
      },
      handleAction: vi.fn(),
    });
    const viewContext = {
      capabilities: {
        canOpenClinicalDocuments: true,
        canOpenExamRequest: true,
        canOpenImagingRequest: true,
        canOpenHistory: true,
        canShowClinicalDocumentIndicator: true,
      },
      indicators: {
        hasClinicalDocument: true,
        isNewAdmission: false,
      },
    };

    const main = buildPatientMainSectionBindings({
      bed,
      bedType: BedType.MEDIA,
      data,
      currentDateString: '2026-03-05',
      readOnly: false,
      actionMenuAlign: 'top',
      diagnosisMode: 'free',
      runtime,
      viewContext,
    });
    const sub = buildPatientSubSectionBindings({
      data,
      currentDateString: '2026-03-05',
      readOnly: false,
      diagnosisMode: 'cie10',
      runtime,
    });
    const modals = buildPatientModalSectionBindings({
      bedId: bed.id,
      data,
      currentDateString: '2026-03-05',
      isSubRow: false,
      runtime,
      viewContext,
    });

    expect(main.indicators.hasClinicalDocument).toBe(true);
    expect(main.onOpenHistory).toBe(runtime.uiState.openHistory);
    expect(main.onOpenDemographics).toBe(runtime.uiState.openDemographics);
    expect(sub.onChange).toBe(runtime.handlers.cribInputChangeHandlers);
    expect(sub.onOpenDemographics).toBe(runtime.uiState.openDemographics);
    expect(modals.canOpenClinicalDocuments).toBe(true);
    expect(modals.canOpenExamRequest).toBe(true);
    expect(modals.canOpenImagingRequest).toBe(true);
    expect(modals.canOpenHistory).toBe(true);
    expect(modals.showHistory).toBe(true);
    expect(modals.onCloseHistory).toBe(runtime.uiState.closeHistory);
    expect(modals.onRevertEmptyDemographics).toBe(runtime.modalSavers.onRevertEmptyDemographics);
  });
});
