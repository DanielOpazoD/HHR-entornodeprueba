// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  buildPatientMainRowBindings,
  buildPatientRowBindings,
  buildPatientRowModalsBindings,
  buildPatientSubRowBindings,
} from '@/features/census/controllers/patientRowBindingsController';
import type { PatientRowRuntime } from '@/features/census/components/patient-row/patientRowRuntimeContracts';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType } from '@/types/domain/beds';

const createInputHandlers = (): PatientRowRuntime['handlers'] => ({
  mainInputChangeHandlers: {
    text: vi.fn(() => vi.fn()),
    check: vi.fn(() => vi.fn()),
    devices: vi.fn(),
    deviceDetails: vi.fn(),
    deviceHistory: vi.fn(),
    toggleDocType: vi.fn(),
    deliveryRoute: vi.fn(),
    multiple: vi.fn(),
  },
  cribInputChangeHandlers: {
    text: vi.fn(() => vi.fn()),
    check: vi.fn(() => vi.fn()),
    devices: vi.fn(),
    deviceDetails: vi.fn(),
    deviceHistory: vi.fn(),
    multiple: vi.fn(),
  },
});

const createRuntime = (overrides: Partial<PatientRowRuntime> = {}): PatientRowRuntime => ({
  bedTypeToggles: {
    onToggleBedType: vi.fn(),
    onUpdateClinicalCrib: vi.fn(),
  },
  rowState: {
    isBlocked: false,
    isEmpty: false,
    hasCompanion: false,
    hasClinicalCrib: false,
    isCunaMode: false,
  },
  uiState: {
    showDemographics: false,
    showClinicalDocuments: false,
    showExamRequest: false,
    showImagingRequest: false,
    showHistory: false,
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
  handlers: createInputHandlers(),
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
  ...overrides,
});

describe('patientRowBindingsController', () => {
  it('builds main/sub/modal bindings from runtime contract', () => {
    const bed = { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false };
    const data = DataFactory.createMockPatient('R1');
    const runtime = createRuntime({
      uiState: {
        ...createRuntime().uiState,
        showExamRequest: true,
      },
    });

    const result = buildPatientRowBindings({
      bed,
      bedType: BedType.MEDIA,
      data,
      currentDateString: '2026-02-15',
      readOnly: false,
      actionMenuAlign: 'top',
      diagnosisMode: 'free',
      isSubRow: false,
      role: 'doctor_urgency',
      indicators: {
        hasClinicalDocument: true,
        isNewAdmission: true,
      },
      runtime,
    });

    expect(result.mainRowProps.bed).toBe(bed);
    expect(result.mainRowProps.data).toBe(data);
    expect(result.mainRowProps.onAction).toBe(runtime.handleAction);
    expect(result.mainRowProps.indicators.hasClinicalDocument).toBe(true);
    expect(result.mainRowProps.indicators.isNewAdmission).toBe(true);
    expect(result.mainRowProps.onOpenClinicalDocuments).toBe(runtime.uiState.openClinicalDocuments);
    expect(result.subRowProps.onOpenDemographics).toBe(runtime.uiState.openDemographics);
    expect(result.modalsProps.bedId).toBe('R1');
    expect(result.modalsProps.onSaveDemographics).toBe(runtime.modalSavers.onSaveDemographics);
    expect(result.modalsProps.showClinicalDocuments).toBe(false);
    expect(result.modalsProps.canOpenClinicalDocuments).toBe(true);
    expect(result.modalsProps.canOpenExamRequest).toBe(true);
    expect(result.modalsProps.canOpenImagingRequest).toBe(true);
    expect(result.modalsProps.canOpenHistory).toBe(true);
  });

  it('builds split bindings with consistent runtime wiring', () => {
    const bed = { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false };
    const data = DataFactory.createMockPatient('R1');
    const runtime = createRuntime({
      rowState: {
        isBlocked: true,
        isEmpty: false,
        hasCompanion: true,
        hasClinicalCrib: true,
        isCunaMode: false,
      },
      uiState: {
        ...createRuntime().uiState,
        showDemographics: true,
        showClinicalDocuments: true,
        showHistory: true,
      },
    });

    const main = buildPatientMainRowBindings({
      bed,
      bedType: BedType.MEDIA,
      data,
      currentDateString: '2026-02-15',
      readOnly: false,
      actionMenuAlign: 'top',
      diagnosisMode: 'free',
      role: 'viewer',
      indicators: {
        hasClinicalDocument: false,
        isNewAdmission: false,
      },
      runtime,
    });
    const sub = buildPatientSubRowBindings({
      data,
      currentDateString: '2026-02-15',
      readOnly: false,
      diagnosisMode: 'cie10',
      runtime,
    });
    const modals = buildPatientRowModalsBindings({
      bed,
      data,
      currentDateString: '2026-02-15',
      isSubRow: false,
      role: 'viewer',
      runtime,
    });
    const adminModals = buildPatientRowModalsBindings({
      bed,
      data,
      currentDateString: '2026-02-15',
      isSubRow: false,
      role: 'admin',
      runtime,
    });

    expect(main.isBlocked).toBe(true);
    expect(main.hasCompanion).toBe(true);
    expect(sub.diagnosisMode).toBe('cie10');
    expect(sub.onOpenDemographics).toBe(runtime.uiState.openDemographics);
    expect(modals.showClinicalDocuments).toBe(true);
    expect(modals.canOpenClinicalDocuments).toBe(false);
    expect(modals.canOpenExamRequest).toBe(true);
    expect(modals.canOpenImagingRequest).toBe(true);
    expect(modals.canOpenHistory).toBe(true);
    expect(modals.showHistory).toBe(true);
    expect(modals.canUseArbitraryAdmissionDate).toBe(false);
    expect(adminModals.canUseArbitraryAdmissionDate).toBe(true);
  });

  it('builds modal bindings from section builder when capabilities are overridden', () => {
    const bed = { id: 'R2', name: 'R2', type: BedType.MEDIA, isCuna: false };
    const data = DataFactory.createMockPatient('R2');
    const runtime = createRuntime({
      uiState: {
        ...createRuntime().uiState,
        showClinicalDocuments: true,
        showExamRequest: true,
        showImagingRequest: true,
        showHistory: true,
      },
    });

    const modals = buildPatientRowModalsBindings({
      bed,
      data,
      currentDateString: '2026-02-15',
      isSubRow: false,
      role: 'viewer',
      capabilitiesOverride: {
        canOpenClinicalDocuments: false,
        canOpenExamRequest: false,
        canOpenImagingRequest: false,
        canOpenHistory: false,
        canShowClinicalDocumentIndicator: false,
      },
      runtime,
    });

    expect(modals.showClinicalDocuments).toBe(true);
    expect(modals.showExamRequest).toBe(true);
    expect(modals.showImagingRequest).toBe(true);
    expect(modals.showHistory).toBe(true);
    expect(modals.canOpenClinicalDocuments).toBe(false);
    expect(modals.canOpenExamRequest).toBe(false);
    expect(modals.canOpenImagingRequest).toBe(false);
    expect(modals.canOpenHistory).toBe(false);
  });
});
